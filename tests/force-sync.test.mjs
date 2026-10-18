import test from 'node:test';import assert from 'node:assert/strict';
import {zipSync,strToU8} from 'fflate';
import {forcePreflight,compareForceImport} from '../src/force-sync.mjs';
import {pcbScript,pcbSchemas} from '../src/pcb.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const doc=(uuid,docType,rows)=>[{type:'DOCHEAD',body:{uuid,docType}},...rows];
const pack=rows=>Buffer.from(zipSync({'models.epru':strToU8(rows.map(r=>JSON.stringify({type:r.type,...(r.id?{id:r.id}:{}),...(r.ticket?{ticket:r.ticket}:{})})+'||'+(r.deleted?'':JSON.stringify(r.body))+'|').join('\n'))})).toString('base64');
function fixture(){const config=[{type:'CANVAS',id:'c',body:{originX:0,originY:0}},{type:'RULE',id:'r',body:{enabled:true}}],model=doc('fp','FOOTPRINT',[{type:'META',id:'m',body:{source:'lib-fp|lib'}}]);const schematic=[...doc('sch','SCH_PAGE',[{type:'TEXT',id:'note',body:{text:'keep'}}]),...model];
 const expected=[{uniqueId:'R1',convertToPcb:true,pins:[{number:'1',net:'IN'}]}];
 const inventory={status:'ok',counts:{Line:0,Pad:0},standaloneCounts:{Line:0,Pad:0}};
 const pre={pcbData:pack(doc('pcb','PCB',config)),schematicData:pack(schematic),pcbDocumentUuid:'pcb',verification:{comparison:{status:'matched'},netlist:{components:expected},document:{components:[{}]}},inventory,pcbDocument:{status:'ok',truncated:false,components:[]}};
 const added=[{type:'COMPONENT',id:'x',body:{attrs:{'Unique ID':'R1'}}},{type:'ATTR',id:'attr',body:{parentId:'x',key:'Designator',value:'R1'}},{type:'PAD_NET',id:'["PAD_NET","x","1","pad"]',body:{padNet:'IN'}},{type:'NET',id:'["NET","IN"]',body:{retLine:true}}];
 const verification={status:'ok',comparison:{status:'matched'},inventory,pcbDocument:{components:[{id:'x',uniqueId:'R1',pins:[{id:'xpad',number:'1',net:'IN'}]}]}};
 return {pre,config,schematic,model,added,verification,post:()=>({pcbData:pack([...doc('pcb','PCB',[...config,...added]),...model]),schematicData:pack(schematic),verification})};}
test('force proof includes full empty native board, source models and complete expected net scope',()=>{const f=fixture(),p=forcePreflight(f.pre),r=compareForceImport(p,f.post());assert.equal(r.status,'matched');assert.equal(r.expectedInstances,1);assert.equal(r.expectedPins,1);assert.deepEqual(r.expectedNets,['IN']);});
test('nonempty or unknown source inventory cannot be authorized by an empty API count',()=>{
 for(const mutate of [f=>f.pre.pcbData=pack(doc('pcb','PCB',[...f.config,{type:'LINE',id:'hidden',body:{width:.01}}])),f=>f.pre.inventory={status:'unknown'},f=>f.pre.pcbDocument.truncated=true,f=>f.pre.verification.netlist.components[0].convertToPcb=false,f=>f.pre.schematicData=pack(doc('sch','SCH_PAGE',[]))]){const f=fixture();mutate(f);assert.throws(()=>forcePreflight(f.pre));}
});
test('force readback rejects rule/model/schematic changes, unplanned nets, copper and deletion identities',()=>{
 for(const mutate of [f=>f.config[1].body.enabled=false,f=>f.model[1].body.source='other|lib',f=>f.schematic[1].body.text='changed',f=>f.added.push({type:'NET',id:'EXTRA',body:{}}),f=>f.added.push({type:'LINE',id:'wire',body:{}}),f=>f.added.push({type:'ATTR',id:'deleted',ticket:1,deleted:true}),f=>f.verification.comparison.status='mismatch']){
  const f=fixture(),before=forcePreflight(f.pre);mutate(f);assert.notEqual(compareForceImport(before,f.post()).status,'matched');
 }
});
test('native force checks current empty target immediately before a single import and uses explicit true only for selected mode',async()=>{
 const p={operation:'import',expectedProjectUuid:'project',schematicUuid:'sch',schematicPageUuid:'page',pcbDocumentUuid:'pcb',importMode:'force_initial_empty'};let calls=[];
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'project',data:[{itemType:'Board',schematic:{uuid:'sch',page:[{uuid:'page'}]},pcb:{uuid:'pcb'}}]})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'pcb',parentProjectUuid:'project',documentType:3})},pcb_PrimitiveComponent:{getAll:async()=>[]},pcb_Document:{importChanges:async(...args)=>{calls.push(args);return true;}}};
 for(const k of ['Line','Arc','Via','Polyline','Pad','Pour','Poured','Fill','Region','Object','Image','Dimension','String'])eda['pcb_Primitive'+k]={getAll:async()=>[]};
 const run=()=>new AsyncFunction('eda','return await '+pcbScript(p))(eda);
 assert.equal((await run()).code,'PCB_IMPORT_REQUIRES_READBACK');assert.deepEqual(calls,[['sch',true]]);
 eda.pcb_PrimitiveVia.getAll=async()=>[{}];assert.equal((await run()).code,'PCB_FORCE_INVENTORY_CHANGED');assert.equal(calls.length,1);
 p.importMode='review';await run();assert.deepEqual(calls[1],['sch']);
});
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {JlcEdaAdapter} from '../src/adapter.mjs';import {circuitSchema} from '../src/drawing.mjs';
test('force timeout is retained across repeat and request-ID/mode changes cannot replay the import',async()=>{
 const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'jlc-force-')));
 try {
  const f=fixture();f.model.push({type:'PAD',id:'pad',body:{num:'1',layerId:1,padType:'NORMAL',hole:null,plated:true}});
  f.pre.schematicData=pack(f.schematic.concat(f.model.at(-1)));
  const component={uniqueId:'R1',designator:'R1',addIntoPcb:true,footprint:{uuid:'fp'}};
  f.pre.verification.document.components=[component];f.pre.verification.netlist.components[0].footprintUuid='fp';
  let attempted=0;
  const file=path.join(root,'work.eprj2');await writeFile(file,'fixture');
  await writeFile(path.join(root,'work-project.json'),JSON.stringify({kind:'task_work_project',sessionId:'s',projectUuid:'project',schematicPageUuid:'page',path:file,openPathConfirmed:true,actions:{},blankVerified:true}));
  const circuit=circuitSchema.parse({components:[{ref:'R1',designator:'R1',deviceUuid:'d',libraryUuid:'lib',supplierId:'C1',manufacturerPart:'R',footprintUuid:'fp',pose:{x:0,y:0}}],nets:[{name:'IN',endpoints:[{ref:'R1',pin:'1'}]}]});
  const p={sessionId:'s',expectedProjectUuid:'project',schematicUuid:'sch',schematicPageUuid:'page',pcbDocumentUuid:'pcb',workDirectory:root,requestId:'sync',circuit,importMode:'force_initial_empty'};
  const a=new JlcEdaAdapter();a.jlc_eda_sessions=async()=>({sessions:[{sessionId:'s',status:'alive',path:file}]});
  a.jlc_eda_inspect_project=async()=>({status:'ok',project:{uuid:'project'},boards:[{name:'b',schematicUuid:'sch',pcbDocumentUuid:'pcb',schematicPageUuids:['page']}],documents:[{uuid:'sch',itemType:'Schematic',boardName:'b'},{uuid:'page',itemType:'Schematic Page',parentSchematicUuid:'sch',boardName:'b'},{uuid:'pcb',itemType:'PCB',boardName:'b'}]});
  a.jlc_eda_verify_schematic=async()=>({status:'ok',...f.pre.verification});
  a.jlc_eda_read_document=async()=>({...f.pre.pcbDocument,documentUuid:'pcb',counts:{components:0}});
  a.jlc_eda_verify_pcb=async()=>({status:'unknown',comparison:{status:'unknown'},inventory:f.pre.inventory});
  a.invoke=async(s,code)=>{
   if(code.includes('"operation":"import"')){attempted++;throw Object.assign(Error('timed out after dispatch'),{code:'CLI_TIMEOUT',status:'unknown'});}
   if(code.includes('"operation":"inventory"'))return f.pre.inventory;
   if(code.includes('"operation":"archive"'))return {status:'ok',data:code.includes('nativePcb')?f.pre.pcbData:f.pre.schematicData};
   return {status:'ok'};
  };
  assert.equal((await a.dispatch('jlc_eda_sync_pcb',p)).code,'CLI_TIMEOUT');assert.equal(attempted,1);
  assert.equal((await a.dispatch('jlc_eda_sync_pcb',{...p,requestId:'other'})).code,'PCB_PRIOR_IMPORT_UNRESOLVED');
  assert.equal((await a.dispatch('jlc_eda_sync_pcb',{...p,importMode:'review'})).code,'REQUEST_CONFLICT');
  assert.equal((await a.dispatch('jlc_eda_sync_pcb',{...p,phase:'retry_unapplied_review'})).code,'PCB_FORCE_REPLAY_FORBIDDEN');
  assert.equal((await a.dispatch('jlc_eda_sync_pcb',p)).code,'PCB_FORCE_READBACK_UNVERIFIED');assert.equal(attempted,1);
  const journal=JSON.parse(await readFile(path.join(root,'work-project.json')));assert.equal(journal.pcbSyncActions.sync.state,'unknown');assert.ok(journal.pcbSyncActions.sync.forceEvidence.fingerprint);
 } finally {await rm(root,{recursive:true,force:true});}
});

test('only the exact paired transient empty-net tombstones are accepted and recorded',()=>{
 const f=fixture(),before=forcePreflight(f.pre);
 const pair=[{type:'NET',id:'["NET",""]',ticket:1,deleted:true},{type:'RULE_SELECTOR',id:'["RULE_SELECTOR",["NET",""]]',ticket:1,deleted:true}];
 f.added.push(...pair);const result=compareForceImport(before,f.post());assert.equal(result.status,'matched');assert.equal(result.initializationTombstones.length,2);
 f.added.pop();assert.equal(compareForceImport(before,f.post()).status,'mismatch');
 f.added.push({...pair[1],id:'["RULE_SELECTOR",["NET","IN"]]'});assert.equal(compareForceImport(before,f.post()).status,'mismatch');
});
