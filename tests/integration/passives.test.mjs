import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,mkdir,writeFile,rm,realpath,symlink} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {unzipSync,zipSync,strToU8,strFromU8} from 'fflate';
import {passiveInput} from '../../src/passive-input.mjs';
import {passiveModel,effectivePassiveModel,transformedPads,projectPassiveProof} from '../../src/passive-model.mjs';
import {planPassive} from '../../src/passive-plan.mjs';
import {replacementPreservation} from '../../src/passive-modification.mjs';
import {passiveLogic} from '../../src/passive-verify.mjs';
import {preserveArchive} from '../../src/eco-preservation.mjs';
import {ecoSchemas,ecoWorkflow} from '../../src/eco.mjs';
import {ecoScript} from '../../src/eco-native.mjs';
import {digest} from '../../src/facts.mjs';
import {fingerprint} from '../../src/drawing.mjs';
import {resourceIdentityScript} from '../../src/resources.mjs';
const f=JSON.parse(await readFile(process.env.PASSIVE_REAL_FIXTURE,'utf8'));
const modify=()=>planPassive(passiveInput.parse(f.modifyInput),f.beforeModify,f.modifyParts,f.ancestor);
const rewrite=(data,fn)=>{const files=unzipSync(Buffer.from(data,'base64'));for(const [name,bytes]of Object.entries(files))if(name.endsWith('.epru')){let uuid;files[name]=strToU8(strFromU8(bytes).split('\n').map(line=>{if(!line.trim())return line;const i=line.indexOf('||'),h=JSON.parse(line.slice(0,i)),b=JSON.parse(line.slice(i+2).replace(/\|$/,''));if(h.type==='DOCHEAD')uuid=b.uuid;fn(uuid,h,b);return JSON.stringify(h)+'||'+JSON.stringify(b)+'|';}).join('\n'));}return Buffer.from(zipSync(files)).toString('base64');};
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('passives accept two bounded semantic modes; reject mixed stages, code, arbitrary angle and missing pin',()=>{
 const p=passiveInput.parse(f.addInput);assert.equal(p.additions.length,2);
 for(const change of [x=>x.modifications=f.modifyInput.modifications,x=>x.additions[0].pcb.rotation=45,x=>x.additions[0].pins.pop(),x=>x.additions[0].code='eda...',x=>x.additions[0].pcb.atMm[0]=Infinity]){const x=structuredClone(f.addInput);change(x);assert.throws(()=>passiveInput.parse(x));}
 assert.equal(ecoSchemas.jlc_eda_schematic_eco.shape.mode.parse(undefined),'single_point');
});
test('real R and MLCC library files produce distinct two-pin models, reject crossed kind/polar type and malformed pin numbering',()=>{
 for(const [id,kind]of [['C25819','R'],['C14663','C']]){const model=passiveModel(f.modifyParts[id],kind);assert.equal(model.pads.length,2);assert.equal(model.pins.length,2);assert.equal(model.part.supplierId,id);}
 assert.throws(()=>passiveModel(f.modifyParts.C25819,'C'));
 const bad=structuredClone(f.modifyParts.C14663);bad.device.parameters['Temperature Coefficient']='POLAR';assert.throws(()=>passiveModel(bad,'C'));
 const wrong=structuredClone(f.modifyParts.C25819);wrong.footprintRead.source=wrong.footprintRead.source.replace('"num":"2"','"num":"1"');assert.throws(()=>passiveModel(wrong,'R'),/TWO_PIN/);
});
test('current project template preserves actual offsets/paste; all orthogonal pad transforms retain pin-to-net direction',()=>{
 const m=effectivePassiveModel(f.modifyParts.C25819,'R',f.beforeModify);assert.ok(m.expectedExistingFootprint);assert.notDeepEqual(m.pads,m.libraryPads);
 const source=m.pads.find(p=>p.num==='1'),x=source.centerX+source.padOffsetX,y=source.centerY+source.padOffsetY;
 const expected=[[x,y],[-y,x],[-x,-y],[y,-x]];
 for(const [i,rotation]of [0,90,180,270].entries()){const p=transformedPads(m,{atMm:[.254,.508],rotation},[{number:'1',net:'A'},{number:'2',net:'B'}],'instance').find(p=>p.number==='1');close(p.x,10+expected[i][0]);close(p.y,20+expected[i][1]);assert.equal(p.net,'A');}
});
test('actual A plan passes full copper/rule preflight and rejects duplicate pins, wrong net, nominal pad start and outside-board placement',()=>{
 const plan=planPassive(passiveInput.parse(f.addInput),f.beforeAdd,f.addParts);assert.equal(plan.targets.length,2);assert.equal(plan.targets[0].projectedPins.length,2);
 for(const change of [x=>x.additions[0].pins[1].number='1',x=>x.additions[0].pins[1].net='NEW',x=>x.additions[0].connections[0].points[0][0]+=.00002,x=>{x.additions[0].pcb.atMm=[50,50];}]){const x=structuredClone(f.addInput);change(x);assert.throws(()=>planPassive(passiveInput.parse(x),f.beforeAdd,f.addParts));}
});
test('actual B plan selects exactly four known public branch LINEs; reject partial/unowned/source-open and wrong old-net removal',()=>{
 const p=modify(),t=p.targets.find(t=>t.input.reconnect);assert.equal(t.removeOperations.length,4);assert.equal(new Set(t.removeOperations.map(o=>o.id)).size,4);
 for(const change of [x=>x.modifications[0].reconnect.removeBranches[0].points.pop(),x=>x.modifications[0].reconnect.removeBranches[0].net='V3V3',x=>x.modifications[0].reconnect.oldNet='V3V3']){const x=structuredClone(f.modifyInput);change(x);assert.throws(()=>planPassive(passiveInput.parse(x),f.beforeModify,f.modifyParts,f.ancestor));}
 for(const change of [x=>x.finish.state='open',x=>{const key=Object.keys(x.passiveECO.steps).find(k=>k.startsWith('local/')&&x.passiveECO.steps[k].result.primitiveId===t.removeOperations[0].id);x.passiveECO.steps[key].result.primitiveId='foreign';}]){const journal=structuredClone(f.ancestor);change(journal);assert.throws(()=>planPassive(passiveInput.parse(f.modifyInput),f.beforeModify,f.modifyParts,journal));}
});
test('same package name cannot justify changed pad geometry; mirrored SCH and bottom PCB are rejected before any mutation',()=>{
 const input=passiveInput.parse(f.modifyInput);
 for(const change of [x=>x.document.components.find(c=>c.designator==='R4').layer=2,x=>x.schematicDocument.components.find(c=>c.designator==='R4').mirror=true,x=>{const fp=x.schematicDocument.components.find(c=>c.designator==='R4').footprint.uuid;x.schematicData=rewrite(x.schematicData,(u,h,b)=>{if(u===fp&&h.type==='PAD')b.defaultPad.width+=.001;});}]){const before=structuredClone(f.beforeModify);change(before);assert.throws(()=>planPassive(input,before,f.modifyParts,f.ancestor));}
});
test('actual native R4 replacement is verified by real source/value/identity and bounded metadata, while other same-model instances stay exact',()=>{
 const t=modify().targets.find(t=>t.input.designator==='R4');const proof=replacementPreservation(f.beforeModify,f.r4Replacement.partial,t,f.pageUuid);assert.equal(proof.status,'matched',JSON.stringify(proof.issues));assert.equal(proof.modelViewChanges.length,2);assert.ok(proof.preservation.exactPreservedRecords>1600);assert.ok(proof.preservation.acceptedTargetEdits>0);
 const c=f.r4Replacement.partial.schematicDocument.components.find(c=>c.uniqueId===t.uniqueId);assert.equal(projectPassiveProof(f.r4Replacement.partial.schematicData,c,t.model,t.retainedSources).status,'matched');
 for(const change of [x=>x.schematicDocument.components.find(c=>c.uniqueId===t.uniqueId).supplierId='C25803',x=>x.schematicDocument.components.find(c=>c.uniqueId===t.uniqueId).properties.Value='100kΩ',x=>{x.schematicData=rewrite(x.schematicData,(u,h,b)=>{if(h.type==='META'&&b.source===t.model.part.uuid+'|'+t.model.part.libraryUuid)b.source='counterfeit|library';});},x=>{const other=x.schematicDocument.components.find(c=>c.designator==='R1').id;x.schematicData=rewrite(x.schematicData,(u,h,b)=>{if(u===f.pageUuid&&h.type==='COMPONENT'&&h.id===other)b.x+=1;});}]){const after=structuredClone(f.r4Replacement.partial);change(after);assert.equal(replacementPreservation(f.beforeModify,after,t,f.pageUuid).status,'mismatch');}
});
test('native preview exception rejects extra filters, altered copper or different display values',()=>{
 const t=modify().targets.find(t=>t.input.designator==='R4');
 for(const change of [b=>b.color='#ff0000',b=>b.layerId=1]){const after=structuredClone(f.r4Replacement.partial);after.schematicData=rewrite(after.schematicData,(u,h,b)=>{if(u===t.oldSchematic.footprint.uuid&&h.type==='PRIMITIVE'&&h.id==='["PRIMITIVE","ALL"]')change(b);});assert.equal(replacementPreservation(f.beforeModify,after,t,f.pageUuid).status,'mismatch');}
 const after=structuredClone(f.r4Replacement.partial);after.schematicData=rewrite(after.schematicData,(u,h,b)=>{if(u===t.oldSchematic.footprint.uuid&&h.type==='PAD')b.defaultPad.width+=.00001;});assert.equal(replacementPreservation(f.beforeModify,after,t,f.pageUuid).status,'mismatch');
});
test('declared logical material/pin edits pass, any other pin or instance change and extra net fail',()=>{
 const plan=modify(),after=structuredClone(f.beforeModify.connectivity);
 for(const t of plan.targets){const c=after.netlist.components.find(c=>c.uniqueId===t.uniqueId);c.supplierId=t.model.part.supplierId;c.manufacturerPart=t.model.part.manufacturerPart;if(t.input.reconnect)c.pins.find(p=>p.number===t.input.reconnect.pin).net=t.input.reconnect.newNet;}
 assert.equal(passiveLogic(f.beforeModify.connectivity,after,plan).status,'matched');
 for(const change of [x=>x.netlist.components.find(c=>c.designator==='R4').pins.find(p=>p.number==='1').net='GND',x=>x.netlist.components.find(c=>c.designator==='R1').supplierId='C25819',x=>x.netlist.netNames.push('ADDED')]){const bad=structuredClone(after);change(bad);assert.equal(passiveLogic(f.beforeModify.connectivity,bad,plan).status,'mismatch');}
});
test('declared deletion really removes old LINE; keeping it or removing any other record fails',()=>{
 const t=modify().targets.find(t=>t.input.reconnect),file=f.beforeModify.data,ids=new Set(t.removeOperations.map(o=>o.id)),options={mainUuid:f.beforeModify.document.documentUuid,edits:t.removeOperations.map(o=>({type:'LINE',id:o.id,after:null}))};
 const files=unzipSync(Buffer.from(file,'base64'));for(const [name,bytes]of Object.entries(files))if(name.endsWith('.epru'))files[name]=strToU8(strFromU8(bytes).split('\n').filter(line=>{if(!line.trim())return true;const h=JSON.parse(line.split('||')[0]);return !(h.type==='LINE'&&ids.has(h.id));}).join('\n'));
 const result=preserveArchive(file,Buffer.from(zipSync(files)).toString('base64'),options);assert.equal(result.status,'matched');assert.equal(result.acceptedTargetDeletions,4);assert.equal(preserveArchive(file,file,options).status,'mismatch');
});
async function fixture({closed=false,unknown=false}={}){
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'passive-tests-'))),dir=path.join(root,'work');await mkdir(dir);const source=path.join(root,'source.eprj2'),checkpoint=path.join(root,'source.json'),file=path.join(dir,'work.eprj2');await writeFile(source,'source');await writeFile(checkpoint,'checkpoint');await writeFile(file,'result');
 const r={kind:'schematic_pcb_eco_work_project',requestId:'test',path:file,source:{path:source,sha256:digest(Buffer.from('source')),checkpointPath:checkpoint,checkpointSha256:digest(Buffer.from('checkpoint'))},sessionId:'s',projectUuid:'project',schematicPageUuid:'sch',schematicUuid:'root',pcbDocumentUuid:'pcb',baseline:{document:{components:[]}},passiveECO:{steps:{},parts:{C25819:{}},plan:{targets:[{action:'modify',input:{designator:'R4'}}]},inputFingerprint:fingerprint(passiveInput.parse(f.modifyInput)),sync:unknown?{state:'unknown',error:{code:'TIMEOUT'}}:{state:'review_required',result:{nativeResult:true}}}};
 if(closed)r.finish={state:'closed',sourceSha256:digest(Buffer.from('result')),closed:{sessionNoLongerAlive:true},disk:{persistenceVerified:true,resourceCleanup:{status:'ok'}},result:{status:'ok',path:file,workDirectory:dir,persistenceVerified:true,fullDesignArchiveCompared:true}};
 const save=()=>writeFile(path.join(dir,'work-project.json'),JSON.stringify(r));await save();const p={sourcePath:source,sourceCheckpointPath:checkpoint,outputDirectory:dir,requestId:'test',mode:'passives',phase:'sync'},calls={invoke:0,read:0,open:0},a={jlc_eda_sessions:async()=>({status:'ok',sessions:[{sessionId:'s',path:file,status:'alive',headless:false}]}),invoke:async(_,script)=>{calls.invoke++;if(script!==resourceIdentityScript)throw Error('unexpected mutation/page switch');return{status:'ok',anchor:'prjPath='+encodeURIComponent(file)};},registerWorkSession:async()=>{},jlc_eda_inspect_project:async()=>({status:'ok',project:{uuid:'project'},documents:[{uuid:'sch',itemType:'Schematic Page'},{uuid:'root',itemType:'Schematic'},{uuid:'pcb',itemType:'PCB'}]}),jlc_eda_read_document:async()=>{calls.read++;return{status:'ok',truncated:false,components:[]};},call:async()=>{calls.open++;throw Error('unexpected CLI');}};
 return{root,dir,source,checkpoint,file,r,p,a,calls,save};
}
const run=(x,p)=>ecoWorkflow.jlc_eda_schematic_eco.call(x.a,p);
for(const unknown of [false,true])test(`passive recorded ${unknown?'unknown':'review'} import cannot replay or switch page through preview/read`,async()=>{const x=await fixture({unknown});try{assert.equal((await run(x,x.p)).importReplayed,false);assert.equal((await run(x,{...x.p,phase:'preview'})).code,'PASSIVE_PENDING_IMPORT_NO_SWITCH');assert.equal((await run(x,{...x.p,phase:'read'})).importReplayed,false);assert.equal(x.calls.invoke,3);assert.equal(x.calls.read,1);assert.equal(x.calls.open,0);}finally{await rm(x.root,{recursive:true});}});
for(const conflict of ['mode','input','candidate','target','source','checkpoint'])test(`passive ${conflict} conflict stops before native/CLI access`,async()=>{const x=await fixture();try{let p=x.p;if(conflict==='mode')p={...p,mode:'single_point'};if(conflict==='input'){const input=structuredClone(f.modifyInput);input.modifications[0].supplierId='OTHER';p={...p,passiveChanges:passiveInput.parse(input)};}if(conflict==='candidate')p={...p,candidateSupplierIds:['C999']};if(conflict==='target')p={...p,targetDesignator:'R1'};if(conflict==='source')await writeFile(x.source,'changed');if(conflict==='checkpoint')await writeFile(x.checkpoint,'changed');await assert.rejects(run(x,p),/ECO_PASSIVE_MODE_REQUIRED|ECO_REQUEST_CONFLICT|ECO_SOURCE_OR_REQUEST_BINDING_MISMATCH/);assert.equal(x.calls.invoke,0);assert.equal(x.calls.open,0);}finally{await rm(x.root,{recursive:true});}});
test('passive closed reuse covers all phases without native work or journal writes, rejects altered/symlink result',async()=>{const x=await fixture({closed:true});try{const old=await readFile(path.join(x.dir,'work-project.json'));for(const phase of ecoSchemas.jlc_eda_schematic_eco.shape.phase.options)assert.equal((await run(x,{...x.p,phase})).completedFileVerified,true);assert.deepEqual(await readFile(path.join(x.dir,'work-project.json')),old);assert.equal(x.calls.invoke,0);await writeFile(x.file,'changed');await assert.rejects(run(x,x.p),/ECO_COMPLETED_FILE_CHANGED/);await rm(x.file);await symlink(x.source,x.file);await assert.rejects(run(x,x.p),/ECO_COMPLETED_FILE_CHANGED/);}finally{await rm(x.root,{recursive:true});}});
test('fixed reconnection modifies only wire NET and its exact Name attribute; rejects changed identity/old bindings before write',async()=>{
 let writes=0,identity='uid',wireNet='GND',portName='GND',parent='port',key='Name';const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'prj'})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'sch',parentProjectUuid:'prj',documentType:1})},sch_PrimitiveComponent:{get:async id=>id==='c'?{getState_UniqueId:()=>identity}:{getState_Net:()=>portName},modify:async()=>{throw Error('NetPort cannot use normal component.modify');}},sch_PrimitiveAttribute:{get:async()=>({getState_ParentPrimitiveId:()=>parent,getState_Key:()=>key,getState_Value:()=>portName}),modify:async(_,p)=>{writes++;portName=p.value;return{};}},sch_PrimitiveWire:{get:async()=>({getState_Net:()=>wireNet}),modify:async(_,p)=>{writes++;wireNet=p.net;return{};}}};const p={operation:'reconnect_stub',expectedProjectUuid:'prj',schematicPageUuid:'sch',component:{id:'c',uniqueId:'uid'},connection:{wireId:'w',labelId:'port',nameAttributeId:'attr'},oldNet:'GND',newNet:'DRDY'};const call=()=>new Function('eda','return '+ecoScript(p))(eda);
 identity='other';assert.equal((await call()).status,'failed');identity='uid';wireNet='OTHER';assert.equal((await call()).status,'failed');wireNet='GND';portName='OTHER';assert.equal((await call()).status,'failed');portName='GND';parent='foreign';assert.equal((await call()).status,'failed');parent='port';key='Value';assert.equal((await call()).status,'failed');key='Name';assert.equal(writes,0);assert.equal((await call()).status,'ok');assert.equal(writes,2);assert.equal(wireNet,'DRDY');assert.equal(portName,'DRDY');
});
test('replacement preparation clears previous selections and confirms only target before UI handoff',async()=>{
 let ids=['R4','C5'],zoom=0;const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'prj'})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'sch',parentProjectUuid:'prj',documentType:1})},sch_PrimitiveComponent:{get:async()=>({getState_UniqueId:()=> 'uid',getState_Designator:()=> 'C5'})},sch_SelectControl:{clearSelected:()=>{ids=[];return true;},doSelectPrimitives:async values=>{ids.push(...values);return true;},getAllSelectedPrimitives_PrimitiveId:async()=>ids},dmt_EditorControl:{zoomToSelectedPrimitives:async()=>{zoom++;}}},p={operation:'prepare_replace',expectedProjectUuid:'prj',schematicPageUuid:'sch',component:{id:'c5',uniqueId:'uid',designator:'C5'}};
 const call=()=>new Function('eda','return '+ecoScript(p))(eda);const result=await call();assert.equal(result.status,'ok');assert.deepEqual(result.selected,['c5']);assert.equal(zoom,1);eda.sch_SelectControl.clearSelected=()=>false;ids=['R4'];assert.equal((await call()).code,'PASSIVE_REPLACEMENT_SELECTION_UNCONFIRMED');assert.equal(zoom,1);
});

import {modifiedSchematicPreservation,modifiedPcbPreservation} from '../../src/passive-modification.mjs';
import {managerViewChanges,managerViewRestorations,passivePresentationFingerprint} from '../../src/passive-native-metadata.mjs';
import {parseNativeSource} from '../../src/native-records.mjs';
import {archiveSources} from '../../src/incremental-source.mjs';
import {passiveDeletionPlaceholders} from '../../src/passive-allocations.mjs';
const dropRow=(data,predicate)=>{const files=unzipSync(Buffer.from(data,'base64'));for(const[name,bytes]of Object.entries(files))if(name.endsWith('.epru')){let uuid;files[name]=strToU8(strFromU8(bytes).split('\n').filter(line=>{if(!line.trim())return true;const i=line.indexOf('||'),h=JSON.parse(line.slice(0,i)),raw=line.slice(i+2).replace(/\|$/,''),b=raw?JSON.parse(raw):null;if(h.type==='DOCHEAD')uuid=b.uuid;return!predicate(uuid,h,b);}).join('\n'));}return Buffer.from(zipSync(files)).toString('base64');};
const rewriteCaptured=(data,fn)=>{const files=unzipSync(Buffer.from(data,'base64'));for(const[name,bytes]of Object.entries(files))if(name.endsWith('.epru')){let uuid;files[name]=strToU8(strFromU8(bytes).split('\n').map(line=>{if(!line.trim())return line;const i=line.indexOf('||'),h=JSON.parse(line.slice(0,i)),raw=line.slice(i+2).replace(/\|$/,''),b=raw?JSON.parse(raw):null;if(h.type==='DOCHEAD')uuid=b.uuid;if(b)fn(uuid,h,b);return JSON.stringify(h)+'||'+(b?JSON.stringify(b):'')+'|';}).join('\n'));}return Buffer.from(zipSync(files)).toString('base64');};
test('actual C5 native replacement restores only previously proved R4 preview records, retains real supplier and all geometry',()=>{
 const t=f.modifyState.plan.targets.find(t=>t.input.designator==='C5'),prior=f.r4Replacement.proof.modelViewChanges;
 assert.equal(replacementPreservation(f.c5Before,f.c5Replacement.partial,t,f.pageUuid,{priorModelViewChanges:prior}).status,'matched');assert.equal(replacementPreservation(f.c5Before,f.c5Replacement.partial,t,f.pageUuid).status,'mismatch');
 const after=structuredClone(f.c5Replacement.partial);after.schematicData=rewrite(after.schematicData,(u,h,b)=>{if(u===t.oldSchematic.footprint.uuid&&h.type==='PAD')b.padOffsetX+=.001;});assert.equal(replacementPreservation(f.c5Before,after,t,f.pageUuid,{priorModelViewChanges:prior}).status,'mismatch');
});
test('actual reconnection changes only source wire NET/NetPort Name and bounded native attribute presentation',()=>{
 assert.equal(modifiedSchematicPreservation(f.modifyRecord,f.modifyState,f.reconnected).status,'matched');
 const t=f.modifyState.plan.targets.find(t=>t.input.reconnect);
 for(const change of [b=>b.zIndex+=2,b=>b.x+=1,b=>b.strikeout=true,b=>b.value='GND']){const data=rewrite(f.reconnected.schematicData,(_,h,b)=>{if(h.type==='ATTR'&&b.parentId===t.schematicConnection.labelId&&b.key==='Name')change(b);});assert.equal(modifiedSchematicPreservation(f.modifyRecord,f.modifyState,{schematicData:data}).status,'mismatch');}
});
test('actual native empty-body deletion records are retained separately; malformed/unbound deletion is rejected',()=>{
 const doc=archiveSources(f.imported.archive.data).get(f.modifyRecord.pcbDocumentUuid);assert.equal(doc.tombstones.length,4);assert.ok(doc.tombstones.every(r=>r.header.type==='PAD_NET'&&r.deleted));assert.ok(doc.rows.every(r=>r.body!==null));
 assert.equal(parseNativeSource('{"type":"LINE","id":"gone","ticket":3}|||')[0].deleted,true);assert.equal(parseNativeSource('{"type":"LINE","id":"gone","ticket":3}||""')[0].deleted,true);
 for(const line of ['{"type":"DOCHEAD","ticket":1}|||','{"type":"LINE","id":"gone"}|||','{"type":"LINE","id":"gone","ticket":2}||{"width":'])assert.throws(()=>parseNativeSource(line));
});
test('native PCB replacement maps semantic identity and all target records, permits observed temporary reset and requires restoration',()=>{
 const proof=modifiedPcbPreservation(f.modifyRecord,f.modifyState,f.imported.archive.data);assert.equal(proof.status,'matched',JSON.stringify(proof.issues));assert.equal(proof.targets.filter(t=>t.primitiveIdChanged).length,2);assert.equal(proof.recordMappings.filter(m=>m.type==='PAD_NET').length,4);assert.equal(proof.allowedTombstones.length,4);
 const state=structuredClone(f.modifyState);state.local={operations:[]};state.plan.targets.forEach(t=>t.removeOperations=[]);const final=modifiedPcbPreservation(f.modifyRecord,state,f.imported.archive.data,{includeLocal:true});assert.equal(final.status,'mismatch');assert.ok(final.issues.some(i=>i.type==='COMPONENT'));assert.ok(final.issues.some(i=>i.type==='ATTR'));
 for(const change of [(u,h,b)=>{if(h.type==='COMPONENT'&&b.attrs?.['Unique ID']===proof.targets[0].uniqueId)b.x+=.001;},(u,h,b)=>{if(h.type==='LINE'&&b.netName==='GND')b.width+=.001;},(u,h,b)=>{if(h.type==='META'&&b.source===f.modifyState.plan.targets[0].model.part.uuid+'|'+f.modifyState.plan.targets[0].model.part.libraryUuid)b.source='wrong|source';}]){const bad=rewriteCaptured(f.imported.archive.data,change);assert.equal(modifiedPcbPreservation(f.modifyRecord,f.modifyState,bad).status,'mismatch');}
});
test('deletion placeholders retain all old bodies in order and use exact typed removed-record budgets',()=>{
 const uuid=f.modifyRecord.pcbDocumentUuid,old=archiveSources(f.importedData).get(uuid).rows,after=archiveSources(f.afterDeletionData).get(uuid).rows,p=passiveDeletionPlaceholders(old,after,{LINE:4},uuid);assert.equal(p.status,'matched');assert.equal(p.recordMappings.length,2);assert.equal(p.added.length,1);assert.equal(p.added[0].body.max,4);
 for(const change of [x=>x.find(r=>r.header.type==='ELE_PLACEHOLDER'&&r.body.dataType==='COMPONENT').body.max++,x=>x.find(r=>r.header.type==='ELE_PLACEHOLDER'&&r.header.id==='placeholder22').body.dataType='RULE',x=>x.find(r=>r.header.type==='ELE_PLACEHOLDER'&&r.header.id==='placeholder24').header.id='placeholder90']){const bad=structuredClone(after);change(bad);assert.equal(passiveDeletionPlaceholders(old,bad,{LINE:4},uuid).status,'mismatch');}
 assert.equal(passiveDeletionPlaceholders(old,after,{LINE:3},uuid).status,'mismatch');
});
test('fresh-document preview restoration has equal qualified fingerprint only for exact registered filters, never altered pad/body',()=>{
 const known=f.modifyState.modelViewChanges,data=f.importedData;let restored=rewriteCaptured(data,(u,h,b)=>{if(known.some(k=>k.uuid===u&&k.id===h.id)&&h.id==='["PRIMITIVE","ALL"]'){b.layerId=0;b.display=true;}});restored=dropRow(restored,(u,h)=>known.some(k=>k.uuid===u&&k.id===h.id)&&h.id==='["PRIMITIVE","PROPERTY"]');assert.equal(managerViewRestorations(data,restored,known).length,2);
 assert.equal(passivePresentationFingerprint(data,known).sha256,passivePresentationFingerprint(restored,known).sha256);
 const fp=known[0].uuid;const changed=rewriteCaptured(restored,(u,h,b)=>{if(u===fp&&h.type==='PAD')b.defaultPad.width+=.00001;});assert.notEqual(passivePresentationFingerprint(data,known).sha256,passivePresentationFingerprint(changed,known).sha256);
 const wrong=rewriteCaptured(data,(u,h,b)=>{if(u===fp&&h.id==='["PRIMITIVE","ALL"]')b.color='#fff';});assert.equal(passivePresentationFingerprint(wrong,known).status,'mismatch');
 assert.equal(managerViewChanges(f.beforeModify.data,restored,[fp]).length,0);
});
