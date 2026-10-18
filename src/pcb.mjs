import{parseNativeSource}from'./native-records.mjs';
import {z} from 'zod';
import {equivalentAngle} from './angles.mjs';
import {isOwnedFootprintVia} from './footprint-vias.mjs';
import {mkdir,realpath,copyFile,readFile,writeFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {unzipSync,strFromU8} from 'fflate';
import {circuitSchema,fingerprint,enrichModelSources,mergeConnectivityComparison,drawingScript} from './drawing.mjs';
import {compareAssignments,digest,parseNetlist} from './facts.mjs';
import {scripts} from './native-scripts.mjs';
import {factsScript} from './native-facts.mjs';
import {bound,load,persist} from './workflow.mjs';
import {withFreshRead,resourceIdentityScript,resourceAnchorPath} from './resources.mjs';
import {ensureTaskContext} from './task-session.mjs';
import {forcePreflight,compareForceImport} from './force-sync.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const readTarget={sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,schematicUuid:id,pcbDocumentUuid:id};
const workTarget={...readTarget,workDirectory:z.string().min(1).max(4096)};
export const pcbSchemas={
 jlc_eda_derive_work_project:z.object({sourcePath:z.string().min(1).max(4096),outputDirectory:z.string().min(1).max(4096),requestId:id,circuit:circuitSchema,sourcePcbState:z.enum(['empty','synchronized_unrouted']).default('empty'),sourceCheckpointPath:z.string().min(1).max(4096).optional(),phase:z.enum(['open','recover']).default('open')}).strict(),
 jlc_eda_sync_pcb:z.object({...workTarget,requestId:id,circuit:circuitSchema,phase:z.enum(['apply','verify','retry_unapplied_review']).default('apply'),importMode:z.enum(['review','force_initial_empty']).default('review')}).strict(),
 jlc_eda_verify_pcb:z.object({...readTarget,circuit:circuitSchema}).strict(),
 jlc_eda_reopen_pcb:z.object({...workTarget,circuit:circuitSchema}).strict(),
 jlc_eda_preview_pcb:z.object(workTarget).strict()
};
const fail=(code,message=code,status='failed')=>{throw Object.assign(new Error(message),{code,status});};
export function association(project,p){
 if(project.status!=='ok'||project.project?.uuid!==p.expectedProjectUuid)return {status:'unknown',code:'PCB_PROJECT_IDENTITY_UNCERTAIN'};
 const page=project.documents.find(x=>x.uuid===p.schematicPageUuid&&x.itemType==='Schematic Page');
 const root=project.documents.find(x=>x.uuid===p.schematicUuid&&x.itemType==='Schematic');
 const pcb=project.documents.find(x=>x.uuid===p.pcbDocumentUuid&&x.itemType==='PCB');
 const boards=(project.boards??[]).filter(x=>x.schematicUuid===p.schematicUuid&&x.pcbDocumentUuid===p.pcbDocumentUuid&&x.schematicPageUuids?.includes(p.schematicPageUuid));
 if(!page||!root||!pcb||page.parentSchematicUuid!==p.schematicUuid||boards.length!==1||!boards[0].name||page.boardName!==boards[0].name||root.boardName!==boards[0].name||pcb.boardName!==boards[0].name)return {status:'failed',code:'PCB_ASSOCIATION_MISMATCH_OR_AMBIGUOUS'};
 if(project.documents.filter(x=>x.itemType==='Schematic').length!==1||project.documents.filter(x=>x.itemType==='Schematic Page').length!==1)return {status:'unsupported',code:'PCB_SINGLE_PAGE_SCOPE_REQUIRED'};
 return {status:'ok',boardName:boards[0].name,schematicUuid:p.schematicUuid,schematicPageUuid:p.schematicPageUuid,pcbDocumentUuid:p.pcbDocumentUuid};
}
// Serialized into the official CLI. All mutations recheck exact project, board and active document.
async function nativePcb(p){
 const matches=async()=>{
  const project=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();
  const boards=(project?.data??[]).filter(x=>x.itemType==='Board'&&x.schematic?.uuid===p.schematicUuid&&x.pcb?.uuid===p.pcbDocumentUuid&&x.schematic?.page?.some(x=>x.uuid===p.schematicPageUuid));
  return project?.uuid===p.expectedProjectUuid&&doc?.uuid===p.pcbDocumentUuid&&doc?.parentProjectUuid===p.expectedProjectUuid&&doc?.documentType===3&&boards.length===1;
 };
 if(!await matches())return {status:'failed',code:'PCB_NATIVE_TARGET_OR_ASSOCIATION_MISMATCH'};
 if(p.operation==='inventory'){
  const counts={},standaloneCounts={},objects=[],componentPads=new Map();
  const components=await eda.pcb_PrimitiveComponent.getAll();
  for(const component of components){const owner=component.getState_PrimitiveId(),pads=await eda.pcb_PrimitiveComponent.getAllPinsByPrimitiveId(owner);
   if(!Array.isArray(pads))return {status:'unknown',code:'PCB_INVENTORY_COMPONENT_PADS_UNAVAILABLE'};
   for(const pad of pads){const pid=pad.getState_PrimitiveId();if(componentPads.has(pid))return {status:'unknown',code:'PCB_INVENTORY_PAD_OWNERSHIP_AMBIGUOUS'};componentPads.set(pid,owner);}
  }
  for(const kind of ['Line','Arc','Via','Polyline','Pad','Pour','Poured','Fill','Region','Object','Image','Dimension','String']){
   const api=eda['pcb_Primitive'+kind];if(typeof api?.getAll!=='function')return {status:'unknown',code:'PCB_INVENTORY_API_MISSING',kind};
   const all=await api.getAll();if(!Array.isArray(all))return {status:'unknown',code:'PCB_INVENTORY_UNAVAILABLE',kind};
   counts[kind]=all.length;
   standaloneCounts[kind]=0;
   for(const x of all){const id=x.getState_PrimitiveId(),componentId=kind==='Pad'?componentPads.get(id)??null:null;
    if(!componentId)standaloneCounts[kind]++;
    objects.push({kind,id,componentId,net:typeof x.getState_Net==='function'?x.getState_Net():null,layer:typeof x.getState_Layer==='function'?x.getState_Layer():null});
   }
  }
  if(!await matches())return {status:'unknown',code:'PCB_TARGET_CHANGED_DURING_READ'};
  return {status:'ok',counts,standaloneCounts,objects,componentPadOwnershipMethod:'exact native pad IDs from getAllPinsByPrimitiveId'};
 }
 if(p.operation==='import'){
  if(typeof eda.pcb_Document.importChanges!=='function')return {status:'unsupported',code:'PCB_IMPORT_API_UNAVAILABLE'};
  if(p.importMode==='force_initial_empty'){
   if((await eda.pcb_PrimitiveComponent.getAll()).length)return {status:'failed',code:'PCB_FORCE_TARGET_NO_LONGER_EMPTY'};
   for(const kind of ['Line','Arc','Via','Polyline','Pad','Pour','Poured','Fill','Region','Object','Image','Dimension','String']){
    const api=eda['pcb_Primitive'+kind];if(typeof api?.getAll!=='function'||(await api.getAll()).length)
     return {status:'failed',code:'PCB_FORCE_INVENTORY_CHANGED',kind};
   }
  }
  const nativeResult=p.importMode==='force_initial_empty'
   ?await eda.pcb_Document.importChanges(p.schematicUuid,true):await eda.pcb_Document.importChanges(p.schematicUuid);
  if(!await matches())return {status:'unknown',code:'PCB_TARGET_CHANGED_DURING_IMPORT',nativeResult};
  return {status:'unknown',code:'PCB_IMPORT_REQUIRES_READBACK',nativeResult,sourceApi:'eda.pcb_Document.importChanges',argumentSchematicUuid:p.schematicUuid,force:p.importMode==='force_initial_empty'};
 }
 if(p.operation==='archive'){
  const f=await eda.sys_FileManager.getDocumentFile('models');if(!f||f.size>2*1024*1024)return {status:'unknown',code:'PCB_MODELS_UNAVAILABLE'};
  let s='';for(const b of new Uint8Array(await f.arrayBuffer()))s+=String.fromCharCode(b);
  return await matches()?{status:'ok',data:btoa(s)}:{status:'unknown',code:'PCB_TARGET_CHANGED_DURING_READ'};
 }
 if(p.operation==='save'){
  const nativeSaveResult=await eda.pcb_Document.save();
  return {status:'unknown',code:await matches()?'PERSISTENCE_NOT_VERIFIED':'PCB_TARGET_CHANGED_DURING_SAVE',nativeSaveResult};
 }
 if(p.operation==='preview'){
  const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();
  await eda.pcb_SelectControl.clearSelected();
  const outlines=[...await eda.pcb_PrimitivePolyline.getAll(),...await eda.pcb_PrimitiveLine.getAll()].filter(x=>x.getState_Layer()===11);
  // Avoid a stale selection overlay in the renderer while fitting the board.
  if(outlines.length)await eda.pcb_Document.zoomToBoardOutline();
  else await eda.dmt_EditorControl.zoomToAllPrimitives(doc.tabId);
  const f=await eda.dmt_EditorControl.getCurrentRenderedAreaImage(doc.tabId);
  if(!f)return {status:'needs_ui',code:'PCB_PREVIEW_UNAVAILABLE'};
  let s='';for(const b of new Uint8Array(await f.arrayBuffer()))s+=String.fromCharCode(b);
  return await matches()?{status:'ok',data:btoa(s),mimeType:f.type}:{status:'unknown',code:'PCB_TARGET_CHANGED_DURING_READ'};
 }
 return {status:'failed',code:'UNKNOWN_PCB_OPERATION'};
}
export const pcbScript=p=>'('+nativePcb.toString()+')('+JSON.stringify(p)+')';
export function footprintModels(data){
 const models=new Map();
 for(const [name,bytes] of Object.entries(unzipSync(Buffer.from(data,'base64')))){
  if(!name.endsWith('.epru'))continue;let current;
  for(const {header:head,body,deleted}of parseNativeSource(strFromU8(bytes))){if(deleted)continue;
   if(head.type==='DOCHEAD'){
    current=body.docType==='FOOTPRINT'?{uuid:body.uuid,pads:[],records:[]}:null;
    if(current){if(models.has(body.uuid))throw new Error('Duplicate footprint document');models.set(body.uuid,current);}
   }
   if(!current)continue;
   if(head.type!=='DOCHEAD')current.records.push({type:head.type,id:head.id??null,body});
   if(head.type==='META'){const [uuid,libraryUuid]=(body.source??'').split('|');current.source={uuid,libraryUuid,title:body.title};}
   if(head.type==='PAD')current.pads.push({id:head.id,number:body.num,layer:body.layerId,padType:body.padType,hole:body.hole,plated:body.plated});
  }
 }
 for(const m of models.values()){m.sha256=fingerprint(m.records);delete m.records;}
 return models;
}
export const pcbSnapshot=doc=>({documentUuid:doc.documentUuid,counts:doc.counts,truncated:doc.truncated,components:doc.components.map(c=>({id:c.id,uniqueId:c.uniqueId,designator:c.designator,device:c.device,footprint:c.footprint,x:c.x,y:c.y,rotation:c.rotation,layer:c.layer,pins:c.pins})).sort((a,b)=>String(a.uniqueId).localeCompare(String(b.uniqueId)))});
export function comparePcb(netlist,schematic,pcb,models,schematicComparison){
 let r=mergeConnectivityComparison(compareAssignments(netlist,[schematic],pcb),schematicComparison);
 const correspondences=[],excluded=[],mechanicalPads=[];
 if(pcb.truncated!==false||pcb.counts?.components!==pcb.components.length)r.issues.push({code:'PCB_FINAL_COVERAGE_UNCERTAIN'});
 for(const c of netlist.components){
  const symbols=schematic.components.filter(x=>x.uniqueId===c.uniqueId),physical=pcb.components.filter(x=>x.uniqueId===c.uniqueId);
  if(symbols.some(x=>x.addIntoPcb!==c.convertToPcb))r.mismatches.push({code:'PCB_CONVERSION_PROPERTY_MISMATCH',uniqueId:c.uniqueId});
  if(!c.convertToPcb){excluded.push({uniqueId:c.uniqueId,designator:c.designator,reason:'native Convert to PCB=false'});continue;}
  if(physical.length!==1)continue;
  const part=physical[0],symbol=symbols[0],model=models.get(part.footprint?.uuid);
  for(const key of ['designator','supplierId','manufacturerPart'])if(part[key]!==c[key])r.mismatches.push({code:'PCB_METADATA_MISMATCH',uniqueId:c.uniqueId,key,expected:c[key],actual:part[key]});
  for(const key of ['device','footprint']){
   const expected=symbol?.[key+'Source'],actual=part[key+'Source'];
   if(!expected?.uuid||!expected.libraryUuid||!actual?.uuid||!actual.libraryUuid)r.issues.push({code:'PCB_MODEL_SOURCE_UNCERTAIN',uniqueId:c.uniqueId,key});
   else if(expected.uuid!==actual.uuid||expected.libraryUuid!==actual.libraryUuid)r.mismatches.push({code:'PCB_MODEL_SOURCE_MISMATCH',uniqueId:c.uniqueId,key,expected,actual});
  }
  if(part.footprint?.uuid!==c.footprintUuid)r.mismatches.push({code:'PCB_PROJECT_FOOTPRINT_MISMATCH',uniqueId:c.uniqueId,expected:c.footprintUuid,actual:part.footprint});
  if(!model?.source?.uuid||!model?.pads?.length){r.issues.push({code:'PCB_FOOTPRINT_MODEL_MISSING',uniqueId:c.uniqueId});continue;}
  const logicalNumbers=new Set(c.pins.map(x=>x.number));
  const numbers=new Set([...model.pads.map(x=>x.number),...part.pins.map(x=>x.number)]);
  for(const number of numbers){
   if(typeof number!=='string'){r.issues.push({code:'PCB_PAD_NUMBER_UNCERTAIN',uniqueId:c.uniqueId,number});continue;}
   const native=model.pads.filter(x=>x.number===number),actual=part.pins.filter(x=>x.number===number);
   if(native.length!==actual.length)r.mismatches.push({code:'PCB_MODEL_PAD_MULTIPLICITY_MISMATCH',uniqueId:c.uniqueId,number,model:native.length,actual:actual.length});
   if(!number){
    // Unnumbered model terminals are retained and checked explicitly, never silently dropped.
    if(actual.some(x=>x.net)||native.some(x=>x.plated!==false&&x.padType!=='MARK_POINT'))r.issues.push({code:'UNNUMBERED_PAD_SEMANTICS_UNCERTAIN',uniqueId:c.uniqueId});
    else mechanicalPads.push({uniqueId:c.uniqueId,modelPads:native,actualPads:actual,reason:'unnumbered unconnected non-plated hole or native mark point'});
   }else if(!logicalNumbers.has(number))r.mismatches.push({code:'PCB_MODEL_PAD_WITHOUT_LOGICAL_PIN',uniqueId:c.uniqueId,number});
  }
  correspondences.push({uniqueId:c.uniqueId,designator:c.designator,pcbPrimitiveId:part.id,symbolPrimitiveIds:symbols.map(x=>x.id),deviceSource:part.deviceSource,footprintSource:part.footprintSource,projectFootprintUuid:part.footprint?.uuid,footprintModelSha256:model.sha256,modelPads:model.pads,actualPads:part.pins});
 }
 r.status=r.issues.length?'unknown':r.mismatches.length?'mismatch':'matched';
 r.correspondences=correspondences;r.excluded=excluded;r.mechanicalPads=mechanicalPads;
 r.coverage={...r.coverage,deviceAndFootprintSourcesCompared:true,modelPadMultiplicityCompared:true,allConvertToPcbComponents:true,erc:false,drcRun:false,copperConnectivityChecked:false};
 return r;
}
export function positionDiff(before,after){
 const changes=[];
 for(const c of before.components){const found=after.components.filter(x=>x.uniqueId===c.uniqueId);
  if(found.length!==1){changes.push({uniqueId:c.uniqueId,code:'PCB_EXISTING_INSTANCE_MISSING_OR_DUPLICATED'});continue;}
  for(const key of ['id','x','y','rotation','layer']){
   const unchanged=key==='rotation'?equivalentAngle(c[key],found[0][key]):['x','y'].includes(key)?Number.isFinite(c[key])&&Number.isFinite(found[0][key])&&Math.abs(c[key]-found[0][key])<=0.0001:c[key]===found[0][key];
   if(!unchanged)changes.push({uniqueId:c.uniqueId,key,before:c[key],after:found[0][key]});
  }
 }
 return changes;
}
export function comparePreservedPcbSnapshot(before,after,{expectedProjectUuid,actualProjectUuid}={}){
 const issues=[],dimensions=new Set(['x','y','width','height','lineWidth','diameter','holeDiameter']);
 const walk=(a,b,at,key)=>{
  // Embedded project libraries receive the fresh context's project UUID.
  // Only the independently bound old/new project pair is substitutable;
  // model UUIDs and external library identities remain exact.
  if(key==='libraryUuid'&&/^pcb\.components\.\d+\.(device|footprint)\.libraryUuid$/.test(at)&&typeof expectedProjectUuid==='string'&&typeof actualProjectUuid==='string'&&a===expectedProjectUuid&&b===actualProjectUuid)return;
  if(key==='rotation'){if(!equivalentAngle(a,b))issues.push({code:'PCB_STAGE_VALUE_CHANGED',path:at,expected:a,actual:b});return;}
  if(dimensions.has(key)&&typeof a==='number'&&typeof b==='number'){if(!Number.isFinite(a)||!Number.isFinite(b)||Math.abs(a-b)>0.0001)issues.push({code:'PCB_STAGE_VALUE_CHANGED',path:at,expected:a,actual:b});return;}
  if(a&&b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)){
   if(Array.isArray(a)&&a.length!==b.length)issues.push({code:'PCB_STAGE_ARRAY_CHANGED',path:at});
   for(const k of new Set([...Object.keys(a),...Object.keys(b)]))walk(a[k],b[k],at+'.'+k,k);
  }else if(fingerprint(a??null)!==fingerprint(b??null))issues.push({code:'PCB_STAGE_VALUE_CHANGED',path:at,expected:a,actual:b});
 };
 walk(before,after,'pcb','');return {status:issues.length?'mismatch':'matched',issues};
}
async function focused(a,p){return a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));}
export async function pcbBound(a,p){
 const ctx=await bound(a,p,{focusSchematic:false}),project=await a.jlc_eda_inspect_project(p),link=association(project,p);
 if(link.status!=='ok')fail(link.code,undefined,link.status);
 if(ctx.r.pcbDocumentUuid&&ctx.r.pcbDocumentUuid!==p.pcbDocumentUuid||ctx.r.schematicUuid&&ctx.r.schematicUuid!==p.schematicUuid)fail('WORK_PCB_TARGET_MISMATCH');
 const focus=await focused(a,p);if(focus.status!=='ok')fail(focus.code,undefined,focus.status);
 return {...ctx,link};
}
async function inventory(a,p){const focus=await focused(a,p);return focus.status==='ok'?a.invoke(p.sessionId,pcbScript({...p,operation:'inventory'})):focus;}
const emptyInventory=r=>r.status==='ok'&&Object.values(r.standaloneCounts??r.counts).every(x=>x===0);
async function preflight(a,p){
 const verification=await a.jlc_eda_verify_schematic({...p,pcbDocumentUuid:undefined});
 if(verification.status!=='ok'||verification.comparison?.status!=='matched')return {status:'failed',code:'PCB_SCHEMATIC_PREFLIGHT_FAILED',verification};
 const doc=verification.document,modelArchive=await a.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));
 if(modelArchive.status!=='ok')return modelArchive;
 const models=footprintModels(modelArchive.data),issues=[];
 for(const c of verification.netlist.components){
  const symbol=doc.components.find(x=>x.uniqueId===c.uniqueId),model=models.get(c.footprintUuid);
  if(symbol?.addIntoPcb!==c.convertToPcb)issues.push({code:'PCB_CONVERSION_PROPERTY_MISMATCH',uniqueId:c.uniqueId});
  if(!c.convertToPcb)continue;
  if(!model?.source?.uuid||!model.source.libraryUuid||!model.pads.length||symbol?.footprint?.uuid!==c.footprintUuid)issues.push({code:'PCB_FOOTPRINT_MISSING_OR_UNCERTAIN',uniqueId:c.uniqueId});
  else{
   for(const pin of c.pins)if(!model.pads.some(x=>x.number===pin.number))issues.push({code:'PCB_FOOTPRINT_PIN_WITHOUT_PAD',uniqueId:c.uniqueId,number:pin.number});
   for(const pad of model.pads)if(pad.number&&!c.pins.some(x=>x.number===pad.number))issues.push({code:'PCB_FOOTPRINT_PAD_WITHOUT_PIN',uniqueId:c.uniqueId,number:pad.number});
  }
 }
 if(issues.length)return {status:'failed',code:'PCB_FOOTPRINT_PREFLIGHT_FAILED',issues,verification};
 const inputFingerprint=fingerprint({netlist:verification.netlist.components,schematic:doc.components,footprints:[...models.values()]});
 return {status:'ok',inputFingerprint,verification,models:[...models.values()]};
}
async function captureForceBefore(a,p){
 const pre=await preflight(a,p);if(pre.status!=='ok')fail('PCB_FORCE_SCHEMATIC_PREFLIGHT_FAILED');
 const schematic=await a.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));
 const inv=await inventory(a,p),doc=await a.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
 const pcb=await a.invoke(p.sessionId,pcbScript({...p,operation:'archive'}));
 if(schematic.status!=='ok'||pcb.status!=='ok')fail('PCB_FORCE_ARCHIVE_UNAVAILABLE');
 return {pre,doc,evidence:forcePreflight({pcbData:pcb.data,schematicData:schematic.data,pcbDocumentUuid:p.pcbDocumentUuid,verification:pre.verification,inventory:inv,pcbDocument:doc})};
}
async function verifyForce(a,p,ctx,action){
 // Bounded observations only. A partial/unknown import never authorizes replay.
 let verification;
 for(let i=0;i<3;i++){
  verification=await a.jlc_eda_verify_pcb(p);
  if(verification.status==='ok'&&verification.comparison?.status==='matched')break;
  if(i<2)await new Promise(resolve=>setTimeout(resolve,300));
 }
 await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'}));
 const sch=await a.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));
 await focused(a,p);const pcb=await a.invoke(p.sessionId,pcbScript({...p,operation:'archive'}));
 const preservation=sch.status==='ok'&&pcb.status==='ok'?compareForceImport(action.forceEvidence,{pcbData:pcb.data,schematicData:sch.data,verification}):{status:'unknown',issues:[{code:'PCB_FORCE_ARCHIVE_UNAVAILABLE'}]};
 const positions=action.after&&verification.pcbDocument?positionDiff(action.after,pcbSnapshot(verification.pcbDocument)):[];
 const ready=verification.status==='ok'&&verification.comparison?.status==='matched'&&preservation.status==='matched'&&!positions.length;
 const result={...verification,status:ready?'ok':'unknown',code:ready?undefined:'PCB_FORCE_READBACK_UNVERIFIED',preservation,
  positionChanges:positions,nativeImport:action.nativeImport??null,nativeImportReplayed:false,importMode:'force_initial_empty',
  nextAction:ready?undefined:'Read back this same request; never replay an unknown force import.'};
 action.state=ready?'completed':'unknown';
 if(ready){action.after=pcbSnapshot(verification.pcbDocument);ctx.r.pcbSyncBaseline={inputFingerprint:action.inputFingerprint,after:action.after};}
 action.result=result;await persist(ctx.dir,ctx.r);return result;
}
async function forceSync(a,p,ctx,requestHash,old){
 if(p.phase==='retry_unapplied_review')fail('PCB_FORCE_REPLAY_FORBIDDEN');
 if(old)return verifyForce(a,p,ctx,old);
 if(p.phase==='verify')fail('PCB_NO_RECORDED_IMPORT');
 if(ctx.r.pcbSyncBaseline||Object.values(ctx.r.actions??{}).some(x=>x.state!=='completed')
  ||Object.values(ctx.r.pcbActions??{}).some(x=>x.state!=='completed'))fail('PCB_FORCE_INITIAL_SCOPE_REQUIRED');
 const before=await captureForceBefore(a,p),latest=await captureForceBefore(a,p);
 if(before.evidence.fingerprint!==latest.evidence.fingerprint||before.pre.inputFingerprint!==latest.pre.inputFingerprint)
  fail('PCB_FORCE_SOURCE_CHANGED_BEFORE_IMPORT');
 Object.assign(ctx.r,{pcbDocumentUuid:p.pcbDocumentUuid,schematicUuid:p.schematicUuid,boardName:ctx.link.boardName});
 const action={hash:requestHash,state:'pending',startedAt:new Date().toISOString(),importMode:'force_initial_empty',
  inputFingerprint:latest.pre.inputFingerprint,before:pcbSnapshot(latest.doc),forceEvidence:latest.evidence};
 ctx.r.pcbSyncActions[p.requestId]=action;await persist(ctx.dir,ctx.r);
 try{await focused(a,p);action.nativeImport=await a.invoke(p.sessionId,pcbScript({...p,operation:'import'}));action.state='unknown';await persist(ctx.dir,ctx.r);}
 catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(ctx.dir,ctx.r);throw e;}
 return verifyForce(a,p,ctx,action);
}
export const pcbWorkflow={
 async jlc_eda_derive_work_project(p){
  if(!path.isAbsolute(p.outputDirectory)||!path.isAbsolute(p.sourcePath))fail('ABSOLUTE_PATH_REQUIRED');
  const known=await load(p.outputDirectory).catch(()=>null);if(p.phase==='recover'&&!known)fail('DERIVE_RECOVERY_NO_RECORDED_REQUEST');if(!known?.sessionId)await this.ensureWorkWindowBudget();
  const source=await realpath(p.sourcePath);if(!/\.eprj2$/i.test(source))fail('WORK_FORMAT_UNSUPPORTED',undefined,'unsupported');
  let r;
  try{await mkdir(p.outputDirectory);}catch(e){if(e.code!=='EEXIST')throw e;
   r=await load(p.outputDirectory).catch(()=>null);
   if(!r||r.derivation?.sourcePath!==source||(r.derivation.sourcePcbState??'empty')!==p.sourcePcbState||r.requestId!==p.requestId||fingerprint(r.circuit)!==fingerprint(p.circuit))fail('OUTPUT_ALREADY_EXISTS');
   if(r.kind==='task_work_project'){
    const dir=await realpath(p.outputDirectory),context=await ensureTaskContext(this,dir,r);if(context.status!=='ok')return {...context,workDirectory:dir};
    let verification;
    if(r.pcbSyncBaseline)verification=await this.verifyRecoveredTask(r,context);
    else{const target={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid,schematicPageUuid:r.schematicPageUuid,schematicUuid:r.schematicUuid,pcbDocumentUuid:r.pcbDocumentUuid,circuit:r.circuit},link=association(context.project,target);if(link.status!=='ok')return link;
     const pre=await preflight(this,target),inv=await inventory(this,target);verification=pre.status==='ok'&&emptyInventory(inv)?{status:'ok',preflight:pre,inventory:inv}:{status:'unknown',code:'TASK_RECOVERY_EMPTY_DESIGN_UNVERIFIED',preflight:pre,inventory:inv};}
    r.lastRecoveryVerification=verification;if(verification.status==='ok')r.bindingStatus='verified';await persist(dir,r);
    return verification.status==='ok'?{status:'ok',...r,workDirectory:dir,reused:context.reused,recoveredSession:context.reopenedClosedTask,activeSessionVerified:true}:{...verification,workDirectory:dir};
   }
   if((!r.sessionId||!r.openPathConfirmed)&&p.phase!=='recover')return {status:'unknown',code:'DERIVE_OUTCOME_UNKNOWN',...r,nextAction:'Inspect the recorded target; derivation is never reopened or recopied automatically.'};
  }
  const dir=await realpath(p.outputDirectory),file=path.join(dir,'work.eprj2'),hash=r?.derivation.sourceSha256??digest(await readFile(source));
  if(!r){
  await copyFile(source,file,constants.COPYFILE_EXCL);
  r={kind:'derivation_pending',requestId:p.requestId,path:file,circuit:p.circuit,actions:{},derivation:{sourcePath:source,sourcePcbState:p.sourcePcbState,sourceSha256:hash,copiedSha256:digest(await readFile(file)),at:new Date().toISOString()}};await persist(dir,r);
  if(r.derivation.copiedSha256!==hash||digest(await readFile(source))!==hash)fail('SOURCE_CHANGED_DURING_COPY',undefined,'unknown');
  const before=await this.jlc_eda_sessions();r.openAttempt={state:'pending',beforeSessionIds:before.sessions.map(x=>x.sessionId),at:new Date().toISOString()};await persist(dir,r);
  let opened;try{opened=await this.call(['open','--path',file],35000);}catch(e){r.openAttempt.state='unknown';r.openAttempt.error={code:e.code,message:e.message};await persist(dir,r);return {status:e.status??'unknown',code:e.code??'DERIVE_OPEN_UNKNOWN',message:e.message,target:{workDirectory:dir,path:file},executionRecord:dir+'/work-project.json',nextAction:'Inspect the exact task path and existing native session. phase=recover only discovers and validates an already opened context; it never reopens or recopies.'};}
  r.openAttempt.state='returned';r.openAttempt.response=opened.value;
  r.sessionId=opened.value?.sessionId;r.openPathConfirmed=opened.value?.path===file;await persist(dir,r);
  if(!id.safeParse(r.sessionId).success||!r.openPathConfirmed||before.sessions.some(x=>x.sessionId===r.sessionId))fail('DERIVE_OPEN_UNCONFIRMED',undefined,'unknown');
  await this.registerWorkSession({sessionId:r.sessionId,path:file,workDirectory:dir});
  }else if(!r.sessionId||!r.openPathConfirmed){
   if(p.phase!=='recover')fail('DERIVE_OUTCOME_UNKNOWN',undefined,'unknown');
   const sessions=await this.jlc_eda_sessions(),matches=[];
   for(const session of sessions.sessions.filter(x=>x.status==='alive'&&x.headless===false&&!r.openAttempt?.beforeSessionIds?.includes(x.sessionId)).slice(0,8)){
    let identity;try{identity=await this.invoke(session.sessionId,resourceIdentityScript);}catch{continue;}
    const anchor=resourceAnchorPath(identity.anchor);if(identity.status==='ok'&&anchor&&await realpath(anchor).catch(()=>null)===file)matches.push({session,identity});
   }
   r.openRecoveryReadback={at:new Date().toISOString(),matches,openedAgain:false};await persist(dir,r);
   if(matches.length!==1)return {status:'needs_ui',code:'DERIVE_EXISTING_CONTEXT_NOT_CONFIRMED',target:{workDirectory:dir,path:file},matches:matches.length,nextAction:'In the installed editor open the exact task copy and switch to PCB1, leaving one visible task window. Preserve this journal; do not replay CLI open. A new registered visible context must be discovered and verified before writes.'};
   r.sessionId=matches[0].session.sessionId;r.openPathConfirmed=true;await persist(dir,r);await this.registerWorkSession({sessionId:r.sessionId,path:file,workDirectory:dir});
  }else{
   const sessions=await this.jlc_eda_sessions(),session=sessions.sessions.find(x=>x.sessionId===r.sessionId&&x.status==='alive');
   if(!session||(session.path&&await realpath(session.path)!==file)||r.path!==file)fail('DERIVE_RECORDED_SESSION_UNCERTAIN',undefined,'unknown');
  }
  this.ownedSessions.add(r.sessionId);
  let project;
  for(let i=0;i<5;i++){project=await this.jlc_eda_inspect_project({sessionId:r.sessionId,expectedProjectUuid:r.projectUuid});if(!['NO_CURRENT_PROJECT','PROJECT_TREE_NOT_READY_OR_EMPTY'].includes(project.code))break;if(i<4)await new Promise(x=>setTimeout(x,300));}
  if(project.status!=='ok')return {...project,target:r,executionRecord:path.join(dir,'work-project.json')};
  const pages=project.documents.filter(x=>x.itemType==='Schematic Page'),pcbs=project.documents.filter(x=>x.itemType==='PCB'),roots=project.documents.filter(x=>x.itemType==='Schematic');
  if(pages.length!==1||pcbs.length!==1||roots.length!==1)fail('DERIVE_SINGLE_BOARD_SCOPE_REQUIRED');
  Object.assign(r,{projectUuid:project.project.uuid,schematicPageUuid:pages[0].uuid,pcbDocumentUuid:pcbs[0].uuid,schematicUuid:roots[0].uuid,documents:project.documents});await persist(dir,r);
  const target={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid,schematicPageUuid:r.schematicPageUuid,pcbDocumentUuid:r.pcbDocumentUuid,schematicUuid:r.schematicUuid,circuit:p.circuit};
  const link=association(project,target);if(link.status!=='ok')fail(link.code);
  const verification=await preflight(this,target);r.derivationVerification=verification;await persist(dir,r);if(verification.status!=='ok')return {...verification,target:r};
  const inv=await inventory(this,target),doc=await this.jlc_eda_read_document({...target,documentUuid:r.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
  if(p.sourcePcbState==='empty'){
   if(!emptyInventory(inv)||doc.status!=='ok'||doc.truncated!==false||doc.counts.components!==0)fail('DERIVE_PCB_NOT_EMPTY','Only empty task PCB targets are accepted unless synchronized_unrouted and its source checkpoint are explicit.','unsupported');
  }else{
   if(!p.sourceCheckpointPath||!path.isAbsolute(p.sourceCheckpointPath))fail('DERIVE_SYNC_CHECKPOINT_REQUIRED');
   const checkpoint=await realpath(p.sourceCheckpointPath),bytes=await readFile(checkpoint),history=JSON.parse(bytes);
   if(history.kind!=='task_work_project'||await realpath(history.path)!==source||fingerprint(history.circuit)!==fingerprint(p.circuit)||!history.pcbSyncBaseline?.after||Object.values(history.pcbSyncActions??{}).some(x=>x.state!=='completed'))fail('DERIVE_SYNC_CHECKPOINT_UNCERTAIN');
   const {readOwnedRouting}=await import('./p3.mjs'),native=await readOwnedRouting(this,target),ownedIds=new Set((native.objects??[]).filter(isOwnedFootprintVia).map(x=>x.primitiveId));
   const sourceInventory={...inv,standaloneCounts:{...inv.standaloneCounts,Via:inv.standaloneCounts?.Via-(inv.objects??[]).filter(x=>x.kind==='Via'&&ownedIds.has(x.id)).length}};
   if(native.status!=='ok'||!emptyInventory(sourceInventory)||native.objects.some(x=>!isOwnedFootprintVia(x))||doc.status!=='ok'||doc.truncated!==false||!doc.counts.components)fail('DERIVE_SYNC_SOURCE_HAS_CONTENT','Only already synchronized, unrouted PCB with no standalone content is supported.','unsupported');
   const actual=await this.jlc_eda_verify_pcb(target);
   if(actual.status!=='ok'||actual.comparison?.status!=='matched'||positionDiff(history.pcbSyncBaseline.after,pcbSnapshot(actual.pcbDocument)).length||fingerprint(history.pcbSyncBaseline.after.components.map(x=>[x.uniqueId,x.id,x.device?.uuid,x.footprint?.uuid,x.pins.map(p=>Object.fromEntries(['id','number','x','y','rotation','net','noConnected','name','pinType','layer','padShape','hole'].map(k=>[k,p[k]])))]))!==fingerprint(pcbSnapshot(actual.pcbDocument).components.map(x=>[x.uniqueId,x.id,x.device?.uuid,x.footprint?.uuid,x.pins.map(p=>Object.fromEntries(['id','number','x','y','rotation','net','noConnected','name','pinType','layer','padShape','hole'].map(k=>[k,p[k]])))])))fail('DERIVE_SYNC_BASELINE_MISMATCH');
   r.derivation.sourceCheckpoint={path:checkpoint,sha256:digest(bytes),history};
   r.derivation.synchronizedVerification=actual;r.pcbSyncBaseline=history.pcbSyncBaseline;
  }
  if(digest(await readFile(source))!==hash)fail('DERIVE_SOURCE_CHANGED',undefined,'unknown');
  Object.assign(r,{kind:'task_work_project',createdAt:new Date().toISOString(),boardName:link.boardName,derivationVerified:true,initialPcb:{inventory:inv,document:doc}});await persist(dir,r);
  return {status:'ok',...r,workDirectory:dir,inspectionCopy:false};
 },
 async jlc_eda_verify_pcb(p){
  const project=await this.jlc_eda_inspect_project(p),link=association(project,p);if(link.status!=='ok')return link;
  const sch=await this.jlc_eda_verify_schematic({...p,pcbDocumentUuid:p.pcbDocumentUuid});
  const incomplete=r=>({...r,comparison:mergeConnectivityComparison({status:'unknown',issues:[{code:r.code??'PCB_VERIFICATION_INCOMPLETE'}],mismatches:[],matched:[],matchedPinAssignments:0},sch.comparison),schematicVerification:sch});
  if(sch.status!=='ok'||!sch.document||!sch.netlist)return incomplete(sch);
  try{
  const pcb=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});if(pcb.status!=='ok')return incomplete(pcb);
  const archive=await this.invoke(p.sessionId,pcbScript({...p,operation:'archive'}));if(archive.status!=='ok')return incomplete(archive);
  let models;try{enrichModelSources(pcb,archive.data);models=footprintModels(archive.data);}catch(e){return incomplete({status:'unknown',code:'PCB_MODEL_SOURCE_UNCERTAIN',message:e.message});}
  const comparison=comparePcb(sch.netlist,sch.document,pcb,models,sch.comparison);
  const inv=await inventory(this,p);if(inv.status!=='ok')return incomplete(inv);
  const lastPcb=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});if(lastPcb.status!=='ok')return incomplete(lastPcb);
  const focus=await this.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'}));if(focus.status!=='ok')return incomplete(focus);
  const raw=await this.invokeLossless(p.sessionId,factsScript({...p,documentUuid:p.schematicPageUuid,operation:'netlist'}));if(raw.status!=='ok')return incomplete(raw);
  const finalNetlist=parseNetlist(raw.source,p.expectedProjectUuid),lastProject=await this.jlc_eda_inspect_project(p),lastLink=association(lastProject,p);
  if(lastLink.status!=='ok'||fingerprint(lastLink)!==fingerprint(link))comparison.issues.push({code:'PCB_ASSOCIATION_CHANGED_DURING_VERIFICATION',lastLink});
  if(finalNetlist.sourceSha256!==sch.netlist.sourceSha256)comparison.issues.push({code:'NETLIST_CHANGED_DURING_PCB_VERIFICATION'});
  if(fingerprint(pcbSnapshot(lastPcb))!==fingerprint(pcbSnapshot(pcb)))comparison.issues.push({code:'PCB_CHANGED_DURING_VERIFICATION'});
  if(pcb.projectUuid!==p.expectedProjectUuid||pcb.documentUuid!==p.pcbDocumentUuid||pcb.kind!=='pcb')comparison.issues.push({code:'PCB_FINAL_TARGET_UNCERTAIN'});
  comparison.status=comparison.issues.length?'unknown':comparison.mismatches.length?'mismatch':'matched';
  return {status:'ok',association:link,comparison,pcbDocument:pcb,inventory:inv,schematicVerification:sch,verification:{netlistStableThroughFinalRead:finalNetlist.sourceSha256===sch.netlist.sourceSha256,pcbStableAcrossFinalRead:fingerprint(pcbSnapshot(lastPcb))===fingerprint(pcbSnapshot(pcb)),atomicEditorSnapshot:false}};
  }catch(e){return incomplete({status:e.status??'unknown',code:e.code??'PCB_FINAL_READ_FAILED',message:e.message});}
 },
 async jlc_eda_sync_pcb(p){
  const ctx=await pcbBound(this,p),{r,dir}=ctx; r.pcbSyncActions??={};
  const requestHash=fingerprint({circuit:p.circuit,schematicUuid:p.schematicUuid,schematicPageUuid:p.schematicPageUuid,pcbDocumentUuid:p.pcbDocumentUuid,
   ...(p.importMode==='force_initial_empty'?{importMode:p.importMode}:{})});
  const old=r.pcbSyncActions[p.requestId];if(old&&old.hash!==requestHash)fail('REQUEST_CONFLICT');
  const unresolved=Object.entries(r.pcbSyncActions).find(([key,x])=>key!==p.requestId&&x.state!=='completed');
  if(unresolved)fail('PCB_PRIOR_IMPORT_UNRESOLVED','Read back the original request; a new request cannot bypass pending/unknown state.','unknown');
  if(p.importMode==='force_initial_empty')return forceSync(this,p,ctx,requestHash,old);
  if(p.phase==='retry_unapplied_review'){
   // Explicit, bounded recovery only for a returned review dialog with a proven
   // zero-effect first import. Never replay a timed-out or partially applied write.
   if(!old||old.state!=='unknown'||old.nativeImport?.nativeResult!==true||old.before.components.length||old.reviewRetryCount)fail('PCB_REVIEW_RETRY_NOT_SAFE',undefined,'unknown');
   const pre=await preflight(this,p),inv=await inventory(this,p),doc=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
   if(pre.status!=='ok'||pre.inputFingerprint!==old.inputFingerprint||!emptyInventory(inv)||doc.status!=='ok'||fingerprint(pcbSnapshot(doc))!==fingerprint(old.before))fail('PCB_REVIEW_ZERO_EFFECT_NOT_PROVEN',undefined,'unknown');
   old.reviewRetryCount=1;old.reviewRecovery={at:new Date().toISOString(),method:'explicit retry after full zero-effect readback',preflight:pre,inventory:inv,pcbReadback:doc,previousImport:old.nativeImport,previousResult:old.result??null};old.state='pending';await persist(dir,r);
   try{const focus=await focused(this,p);if(focus.status!=='ok')fail(focus.code,undefined,focus.status);
    old.nativeImport=await this.invoke(p.sessionId,pcbScript({...p,operation:'import'}));old.state='unknown';
    old.result={status:'needs_ui',code:'PCB_IMPORT_REVIEW_REQUIRED',nativeImport:old.nativeImport,zeroEffectRecovery:true,target:{path:r.path,sessionId:p.sessionId,pcbDocumentUuid:p.pcbDocumentUuid},nextAction:'Apply this task review, then verify this same request. This recovery can run only once.'};await persist(dir,r);return old.result;
   }catch(e){old.state='unknown';old.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
  }
  if(old||p.phase==='verify'){
   if(!old)fail('PCB_NO_RECORDED_IMPORT');
   const verification=await this.jlc_eda_verify_pcb(p),changes=verification.pcbDocument?positionDiff(old.state==='completed'?old.after:old.before,pcbSnapshot(verification.pcbDocument)):[];
   const result={...verification,reusedRequest:true,nativeImportReplayed:false,recordedImport:old.nativeImport??null,positionChanges:changes};
   if(changes.length&&result.comparison){result.comparison.mismatches.push({code:'PCB_EXISTING_POSITION_OR_INSTANCE_CHANGED',changes});result.comparison.status='mismatch';}
   if(verification.status==='ok'&&result.comparison?.status==='matched'){
    old.state='completed';old.result=result;old.after=pcbSnapshot(verification.pcbDocument);old.resolvedByReadback=true;r.pcbSyncBaseline={inputFingerprint:old.inputFingerprint,after:old.after};await persist(dir,r);
   }
   return result;
  }
  const pre=await preflight(this,p);if(pre.status!=='ok')return pre;
  if(r.pcbSyncBaseline&&r.pcbSyncBaseline.inputFingerprint!==pre.inputFingerprint)fail('PCB_INCREMENTAL_CHANGE_UNSUPPORTED',undefined,'unsupported');
  const inv=await inventory(this,p);if(!emptyInventory(inv))return {status:inv.status==='ok'?'unsupported':inv.status,code:inv.status==='ok'?'PCB_EXISTING_CONTENT_UNSUPPORTED':inv.code,inventory:inv};
  const doc=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});if(doc.status!=='ok')return doc;
  if(!r.pcbSyncBaseline&&doc.counts.components)fail('PCB_FIRST_IMPORT_TARGET_NOT_EMPTY',undefined,'unsupported');
  if(r.pcbSyncBaseline&&positionDiff(r.pcbSyncBaseline.after,pcbSnapshot(doc)).length)fail('PCB_REPEAT_POSITION_OR_INSTANCE_CHANGED');
  if(r.pcbSyncBaseline){const checked=await this.jlc_eda_verify_pcb(p);if(checked.status!=='ok'||checked.comparison?.status!=='matched')return {status:'unknown',code:'PCB_REPEAT_BASELINE_MISMATCH',verification:checked};}
  r.pcbDocumentUuid=p.pcbDocumentUuid;r.schematicUuid=p.schematicUuid;r.boardName=ctx.link.boardName;
  const action={hash:requestHash,state:'pending',startedAt:new Date().toISOString(),before:pcbSnapshot(doc),expectedComponents:pre.verification.netlist.components.filter(x=>x.convertToPcb).map(x=>({uniqueId:x.uniqueId,designator:x.designator,footprintUuid:x.footprintUuid})),inputFingerprint:pre.inputFingerprint};
  r.pcbSyncActions[p.requestId]=action;await persist(dir,r);
  try{
   const focus=await focused(this,p);if(focus.status!=='ok')fail(focus.code,undefined,focus.status);
   action.nativeImport=await this.invoke(p.sessionId,pcbScript({...p,operation:'import'}));action.state='unknown';await persist(dir,r);
   // importChanges may return true after opening the native review dialog. Keep
   // that exact PCB active; navigating into schematic verification can hide it.
   const readback=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
   if(action.nativeImport.nativeResult===true&&readback.status==='ok'&&readback.counts.components===action.before.counts.components){
    const result={status:'needs_ui',code:'PCB_IMPORT_REVIEW_REQUIRED',nativeImport:action.nativeImport,pcbReadback:readback,target:{workDirectory:dir,path:r.path,sessionId:p.sessionId,projectUuid:p.expectedProjectUuid,schematicUuid:p.schematicUuid,pcbDocumentUuid:p.pcbDocumentUuid,boardName:ctx.link.boardName},nextAction:'In this exact task PCB review/apply the native changes (or confirm no changes), then call sync_pcb phase=verify using the same request. Do not call import again.'};
    action.result=result;await persist(dir,r);return result;
   }
   const result=await this.jlc_eda_verify_pcb(p);const changes=result.pcbDocument?positionDiff(action.before,pcbSnapshot(result.pcbDocument)):[];
   Object.assign(result,{nativeImport:action.nativeImport,positionChanges:changes,diff:result.pcbDocument?{before:action.before,after:pcbSnapshot(result.pcbDocument),addedUniqueIds:result.pcbDocument.components.filter(x=>!doc.components.some(c=>c.uniqueId===x.uniqueId)).map(x=>x.uniqueId)}:null});
   if(changes.length&&result.comparison){result.comparison.mismatches.push({code:'PCB_EXISTING_POSITION_OR_INSTANCE_CHANGED',changes});result.comparison.status='mismatch';}
   if(result.status==='ok'&&result.comparison?.status==='matched'){
    action.state='completed';action.after=pcbSnapshot(result.pcbDocument);r.pcbSyncBaseline={inputFingerprint:pre.inputFingerprint,after:action.after};
   }else{result.status='unknown';result.code='PCB_IMPORT_NOT_VERIFIED';result.nextAction='Inspect the precise task window and any native dialog, then call phase=verify with this request. Do not import again.';}
   action.result=result;await persist(dir,r);return result;
  }catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(dir,r);e.target={workDirectory:dir,sessionId:p.sessionId,pcbDocumentUuid:p.pcbDocumentUuid,schematicUuid:p.schematicUuid};e.executionRecord=path.join(dir,'work-project.json');throw e;}
 },
 async savePcbWork(p){
  const ctx=await pcbBound(this,p),sch=await this.jlc_eda_save_work_project({...p,pcbDocumentUuid:undefined});
  const focus=await focused(this,p);if(focus.status!=='ok')return focus;
  const pcb=await this.invoke(p.sessionId,pcbScript({...p,operation:'save'}));
  const result={status:'unknown',code:'PERSISTENCE_NOT_VERIFIED',schematicSave:sch,pcbSave:pcb,path:ctx.r.path,nextAction:'Call jlc_eda_reopen_pcb for a new disk copy and native context.'};
  ctx.r.pcbSaveAttempt={...result,at:new Date().toISOString(),requestId:p.requestId};await persist(ctx.dir,ctx.r);return result;
 },
 async jlc_eda_reopen_pcb(p){
  const ctx=await pcbBound(this,p);return withFreshRead(this,ctx.r.path,async fresh=>{
  const uncertain=()=>({...fresh,status:'unknown',code:'PCB_REOPEN_IDENTITY_OR_CONTEXT_UNCERTAIN',persistenceVerified:false});
  if(fresh.status!=='ok')return {...fresh,persistenceVerified:false};
  if(!fresh.freshDiskContext||fresh.reusedOwnedSession||!fresh.inspectionCopy||fresh.sessionId===p.sessionId||fresh.path===ctx.r.path||!id.safeParse(fresh.project?.uuid).success||fresh.sourcePath!==ctx.r.path||fresh.sourceSha256!==digest(await readFile(ctx.r.path)))return uncertain();
  const params={...p,sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid};if(association(fresh,params).status!=='ok')return uncertain();
  let verification;try{verification=await this.jlc_eda_verify_pcb(params);}catch(e){verification={status:e.status??'unknown',code:e.code??'PCB_DISK_VERIFY_FAILED',message:e.message};}
  const result={...verification,reopened:fresh,sourceBinding:{path:ctx.r.path,sourceSha256:fresh.sourceSha256,writeContextProjectUuid:p.expectedProjectUuid,readContextProjectUuid:fresh.project.uuid,schematicUuid:p.schematicUuid,schematicPageUuid:p.schematicPageUuid,pcbDocumentUuid:p.pcbDocumentUuid},persistenceVerified:verification.status==='ok'&&verification.comparison?.status==='matched'};
  const baseline=ctx.r.pcbCopperBaseline?.after??ctx.r.pcbLayoutBaseline?.after??ctx.r.pcbSyncBaseline?.after;
  if(!baseline){result.persistenceVerified=false;result.code='PCB_DISK_BASELINE_MISSING';}
  else if(verification.pcbDocument){const changes=positionDiff(baseline,pcbSnapshot(verification.pcbDocument));result.positionChanges=changes;if(changes.length){result.persistenceVerified=false;result.code='PCB_DISK_POSITION_OR_INSTANCE_MISMATCH';}}
  if(fresh.sourceSha256!==digest(await readFile(ctx.r.path))){result.status='unknown';result.code='SOURCE_CHANGED_DURING_VERIFICATION';result.persistenceVerified=false;}
  if(ctx.r.pcbLayoutBaseline&&result.persistenceVerified){result.p3Verification=await this.verifyP3Checkpoint(params,ctx.r);if(result.p3Verification.comparison?.status!=='matched'){result.persistenceVerified=false;result.code='PCB_P3_CHECKPOINT_NOT_PERSISTED';}}
  ctx.r.pcbReopen=result;await persist(ctx.dir,ctx.r);return result;});
 },
 async jlc_eda_preview_pcb(p){
  const ctx=await pcbBound(this,p),r=await this.invoke(p.sessionId,pcbScript({...p,operation:'preview'}));if(r.status!=='ok')return r;
  const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[r.mimeType];if(!ext)return {status:'unknown',code:'PCB_PREVIEW_FORMAT_UNSUPPORTED',mimeType:r.mimeType};
  const file=path.join(ctx.dir,'pcb.'+ext);await writeFile(file,Buffer.from(r.data,'base64'));return {status:'ok',path:file,mimeType:r.mimeType,sourceApi:'eda.dmt_EditorControl.getCurrentRenderedAreaImage'};
 }
};
