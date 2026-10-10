import {mkdir,readFile,writeFile,realpath,copyFile,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {drawingScript,compareCircuit,fingerprint,enrichModelSources,mergeConnectivityComparison} from './drawing.mjs';
import {scripts} from './native-scripts.mjs';
import {factsScript} from './native-facts.mjs';
import {parseNetlist,digest} from './facts.mjs';
import {withFreshRead} from './resources.mjs';
const fail=(code,message,status='failed')=>{throw Object.assign(new Error(message??code),{code,status});};
export const load=async dir=>JSON.parse(await readFile(path.join(dir,'work-project.json'),'utf8'));
export const persist=async(dir,data)=>writeFile(path.join(dir,'work-project.json'),JSON.stringify(data,null,2)+'\n');
export async function bound(a,p,{focusSchematic=true}={}){
 if(!path.isAbsolute(p.workDirectory))fail('ABSOLUTE_DIRECTORY_REQUIRED');
 const dir=await realpath(p.workDirectory),r=await load(dir);
 if(r.kind!=='task_work_project'||r.sessionId!==p.sessionId||r.projectUuid!==p.expectedProjectUuid||r.schematicPageUuid!==p.schematicPageUuid)fail('WORK_TARGET_MISMATCH');
 if(r.bindingStatus&&r.bindingStatus!=='verified')fail('WORK_RECOVERY_VERIFICATION_REQUIRED');
 const sessions=await a.jlc_eda_sessions(),s=sessions.sessions.find(x=>x.sessionId===p.sessionId&&x.status==='alive');
 if(!s)fail('WORK_SESSION_NOT_ALIVE');
 if(s.path&&await realpath(s.path)!==r.path)fail('WORK_PATH_MISMATCH');
 if(await realpath(r.path)!==r.path||!r.openPathConfirmed)fail('WORK_PATH_UNCONFIRMED');
 if(focusSchematic){const focus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'}));
 if(focus.status!=='ok')fail(focus.code,'Target focus failed',focus.status);}
 return {dir,r};
}
async function action(a,p,context,key,input){
 const {dir,r}=context;r.actions??={};const hash=fingerprint(input),old=r.actions[key];
 if(old){if(old.hash!==hash)fail('REQUEST_CONFLICT');if(old.state==='completed')return old.result;
   if(!old.retryable)fail('ACTION_OUTCOME_UNKNOWN','Inspect recorded target and readback; this action is not replayed.','unknown');}
 r.actions[key]={hash,state:'pending',retryable:false,input,startedAt:new Date().toISOString(),attempts:old?[...(old.attempts??[]),{state:old.state,result:old.result,retryable:old.retryable}]:[]};await persist(dir,r);
 try {const result=await a.invoke(p.sessionId,drawingScript({...p,...input}));
   r.actions[key]={...r.actions[key],state:result.status==='ok'?'completed':result.status==='failed'||result.status==='unsupported'?'failed':'unknown',retryable:['TARGET_MISMATCH','DEVICE_NOT_FOUND','COMPONENT_AMBIGUOUS','PIN_AMBIGUOUS','PIN_DIRECTION_UNSUPPORTED'].includes(result.code),result};await persist(dir,r);return result;
 }catch(e){r.actions[key]={...r.actions[key],state:'unknown',error:{code:e.code,message:e.message}};await persist(dir,r);e.target={workDirectory:dir,sessionId:p.sessionId,projectUuid:p.expectedProjectUuid,schematicPageUuid:p.schematicPageUuid};e.executionRecord=path.join(dir,'work-project.json');throw e;}
}
function incompleteVerification(result,connectivity){
 const comparison=mergeConnectivityComparison({status:'unknown',issues:[{code:result.code??'VERIFICATION_READ_INCOMPLETE'}],mismatches:[],matched:[],matchedPinAssignments:0},connectivity.comparison);
 return {...result,comparison};
}
export const workflow={
 async jlc_eda_create_work_project(p){
  if(!path.isAbsolute(p.outputDirectory)||!path.isAbsolute(p.blankTemplatePath))fail('ABSOLUTE_PATH_REQUIRED');
  const known=await load(p.outputDirectory).catch(()=>null);if(!known?.sessionId)await this.ensureWorkWindowBudget();
  // A new directory is the task boundary. Existing directories never become editable implicitly.
  let r,dir,file;
  try{await mkdir(p.outputDirectory);}catch(e){if(e.code!=='EEXIST')throw e;
   r=await load(p.outputDirectory).catch(()=>null);if(!r||r.requestId!==p.requestId||r.templateSource!==await realpath(p.blankTemplatePath))fail('OUTPUT_ALREADY_EXISTS');
   if(r.kind==='task_work_project')return {status:'ok',...r,workDirectory:await realpath(p.outputDirectory),reused:true};
   if(!r.sessionId)return {status:'unknown',code:'CREATE_OUTCOME_UNKNOWN',...r,nextAction:'Inspect recorded session; do not recreate or recopy.'};}
  dir=await realpath(p.outputDirectory);
  if(!r){const template=await realpath(p.blankTemplatePath);
   if(!/\.eprj2$/i.test(template))fail('WORK_FORMAT_UNSUPPORTED','Editable creation currently supports eprj2 blank templates.','unsupported');
   file=path.join(dir,'work.eprj2');await copyFile(template,file,constants.COPYFILE_EXCL);
   r={kind:'creation_pending',requestId:p.requestId,templateSource:template,path:file,actions:{}};await persist(dir,r);
   const opened=await this.call(['open','--path',file],35000);r.sessionId=opened.value?.sessionId;r.openPathConfirmed=opened.value?.path===file;await persist(dir,r);
   if(!r.sessionId||!r.openPathConfirmed)fail('CREATE_OPEN_UNCONFIRMED',undefined,'unknown');
   await this.registerWorkSession({sessionId:r.sessionId,path:file,workDirectory:dir});
  }
  this.ownedSessions.add(r.sessionId);
  let project;for(let i=0;i<5;i++){project=await this.jlc_eda_inspect_project({sessionId:r.sessionId});if(project.status==='ok')break;await new Promise(x=>setTimeout(x,300));}
  if(project.status!=='ok')return {...project,...r};
  r.projectUuid=project.project.uuid;const pages=project.documents.filter(x=>x.itemType==='Schematic Page');
  if(pages.length!==1)fail('BLANK_TEMPLATE_PAGE_SCOPE_UNSUPPORTED');r.schematicPageUuid=pages[0].uuid;await persist(dir,r);
  const target={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid};
  for(const doc of project.documents.filter(x=>['Schematic Page','PCB'].includes(x.itemType))){
   const read=await this.jlc_eda_read_document({...target,documentUuid:doc.uuid,kind:doc.itemType==='PCB'?'pcb':'schematic',includePins:true,includeGeometry:true,limit:200});
   if(read.status!=='ok'||read.counts.components||read.counts.wires||read.counts.lines||read.counts.viaObjects||read.counts.polylines||(read.counts.nonPartComponents??0)>1)fail('TEMPLATE_NOT_EMPTY','No writable binding was granted.');
  }
  r.kind='task_work_project';r.blankVerified=true;r.createdAt=new Date().toISOString();r.documents=project.documents;
  await persist(dir,r);return {status:'ok',...r,workDirectory:dir,creationMethod:'copy of native empty template; all schematic and PCB design counts read back empty',inspectionCopy:false};
 },
 async jlc_eda_draw_schematic(p){
  if((await load(p.workDirectory)).pcbRepairBaseline)return {status:'unknown',code:'WORK_KNOWN_PARTIAL_SCHEMATIC_IMMUTABLE',nativeMutationReplayed:false};
  const ctx=await bound(this,p),hash=fingerprint(p.circuit),old=ctx.r.circuit;
  if(old&&fingerprint(old)!==hash)fail('CIRCUIT_CONFLICT');
  if(!old){const d=await this.jlc_eda_read_document({...p,documentUuid:p.schematicPageUuid,kind:'schematic',includePins:true,limit:200});
   if(d.status!=='ok'||d.counts.components||d.counts.wires)fail('WORK_PAGE_NOT_EMPTY');ctx.r.circuit=p.circuit;ctx.r.drawRequestId=p.requestId;await persist(ctx.dir,ctx.r);}
  if(ctx.r.drawRequestId!==p.requestId)fail('REQUEST_CONFLICT');
  const title=await action(this,p,ctx,p.requestId+'/title-block',{operation:'title_block',showTitleBlock:p.showTitleBlock});if(title.status!=='ok')return title;
  for(const component of p.circuit.components){const r=await action(this,p,ctx,p.requestId+'/place/'+component.ref,{operation:'place',component});if(r.status!=='ok')return {...r,workDirectory:ctx.dir};}
  const d=await this.jlc_eda_read_document({...p,documentUuid:p.schematicPageUuid,kind:'schematic',includePins:true,includeGeometry:true,limit:200});
  if(d.status!=='ok')return d;
  if(p.phase==='place')return {status:'ok',phase:'placed',document:d};
  // Validate the full endpoint topology before making any wires.
  for(const e of p.circuit.components){const instances=d.components.filter(x=>x.designator===e.designator),actual=instances.flatMap(x=>x.pins.map(p=>p.number));
   const requested=[...p.circuit.nets.flatMap(n=>n.endpoints),...p.circuit.nc].filter(x=>x.ref===e.ref).map(x=>x.pin);
   if(actual.length!==new Set(actual).size||actual.length!==requested.length||actual.some(x=>!requested.includes(x)))fail('PIN_TOPOLOGY_UNVERIFIED','Every actual pin must have exactly one net or explicit NC.');}
  for(const net of p.circuit.nets)for(const endpoint of net.endpoints){const e={...endpoint,designator:p.circuit.components.find(c=>c.ref===endpoint.ref).designator};
   const r=await action(this,p,ctx,p.requestId+'/net/'+endpoint.ref+'/'+endpoint.pin,{operation:'connect',endpoint:e,net:net.name});if(r.status!=='ok')return r;}
  for(const endpoint of p.circuit.nc){const e={...endpoint,designator:p.circuit.components.find(c=>c.ref===endpoint.ref).designator};const r=await action(this,p,ctx,p.requestId+'/nc/'+endpoint.ref+'/'+endpoint.pin,{operation:'connect',endpoint:e,nc:true});if(r.status!=='ok')return r;}
  for(let i=0;i<p.circuit.notes.length;i++){const r=await action(this,p,ctx,p.requestId+'/note/'+i,{operation:'note',note:p.circuit.notes[i]});if(r.status!=='ok')return r;}
  const verification=await this.jlc_eda_verify_schematic(p);ctx.r.lastVerification=verification;await persist(ctx.dir,ctx.r);return verification;
 },
 async jlc_eda_verify_schematic(p){
  const connectivity=await this.jlc_eda_read_connectivity(p);if(connectivity.status!=='ok')return connectivity;
  const doc=await this.jlc_eda_read_document({...p,documentUuid:p.schematicPageUuid,kind:'schematic',includePins:true,includeGeometry:true,limit:200});if(doc.status!=='ok')return incompleteVerification(doc,connectivity);
  const archive=await this.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));if(archive.status!=='ok')return incompleteVerification(archive,connectivity);
  try{enrichModelSources(doc,archive.data);}catch(e){return incompleteVerification({status:'unknown',code:'MODEL_SOURCE_READ_UNCERTAIN',message:e.message},connectivity);}
  const last=await this.invoke(p.sessionId,factsScript({...p,documentUuid:p.schematicPageUuid,operation:'netlist'}));if(last.status!=='ok')return incompleteVerification(last,connectivity);
  let finalNetlist;try{finalNetlist=parseNetlist(last.source,p.expectedProjectUuid);}catch(e){return incompleteVerification({status:e.status??'unknown',code:e.code??'FINAL_NETLIST_READ_FAILED',message:e.message},connectivity);}
  const comparison=mergeConnectivityComparison(compareCircuit(p.circuit,connectivity.netlist,doc),connectivity.comparison);
  if(finalNetlist.sourceSha256!==connectivity.netlist.sourceSha256){comparison.issues.push({code:'NETLIST_CHANGED_DURING_VERIFICATION',before:connectivity.netlist.sourceSha256,after:finalNetlist.sourceSha256});comparison.status='unknown';}
  if(connectivity.projectUuid!==p.expectedProjectUuid||connectivity.netlist.projectUuid!==p.expectedProjectUuid||doc.projectUuid!==p.expectedProjectUuid||doc.documentUuid!==p.schematicPageUuid||doc.kind!=='schematic'||!Array.isArray(connectivity.scope?.schematicPages)||connectivity.scope.schematicPages.length!==1||connectivity.scope.schematicPages[0]!==p.schematicPageUuid){
    comparison.issues.push({code:'VERIFICATION_TARGET_OR_SCOPE_UNCERTAIN'});comparison.status='unknown';
  }
  return {status:'ok',comparison,netlist:connectivity.netlist,document:doc,verification:{netlistStableThroughFinalRead:finalNetlist.sourceSha256===connectivity.netlist.sourceSha256,finalNetlistSha256:finalNetlist.sourceSha256,atomicEditorSnapshot:false}};
 },
 async jlc_eda_save_work_project(p){if(p.pcbDocumentUuid)return this.savePcbWork(p);const ctx=await bound(this,p);const r=await this.invoke(p.sessionId,drawingScript({...p,operation:'save'}));ctx.r.saveAttempt={...r,at:new Date().toISOString(),requestId:p.requestId};await persist(ctx.dir,ctx.r);return {...r,path:ctx.r.path,target:{sessionId:p.sessionId,projectUuid:p.expectedProjectUuid,schematicPageUuid:p.schematicPageUuid}};},
 async jlc_eda_reopen_work_project(p){const ctx=await bound(this,p);
  // A fresh disk copy and fresh native session; never use the in-memory drawing snapshot.
  return withFreshRead(this,ctx.r.path,async fresh=>{if(fresh.status!=='ok')return {...fresh,persistenceVerified:false};
  if(!fresh.freshDiskContext||fresh.reusedOwnedSession||!fresh.inspectionCopy||fresh.sessionId===p.sessionId||fresh.path===ctx.r.path||typeof fresh.project?.uuid!=='string'||! /^[a-zA-Z0-9_-]{1,128}$/.test(fresh.project.uuid)||fresh.sourcePath!==ctx.r.path||fresh.sourceSha256!==digest(await readFile(ctx.r.path))||fresh.documents.filter(d=>d.itemType==='Schematic Page').length!==1||fresh.documents.find(d=>d.itemType==='Schematic Page')?.uuid!==p.schematicPageUuid)return {...fresh,status:'unknown',code:'REOPEN_IDENTITY_OR_CONTEXT_UNCERTAIN',persistenceVerified:false};
  let verification;
  try{verification=await this.jlc_eda_verify_schematic({...p,sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid,schematicPageUuid:p.schematicPageUuid});}
  catch(e){verification={status:e.status??'unknown',code:e.code??'VERIFICATION_FAILED',message:e.message};}
  const result={...verification,reopened:fresh,sourceBinding:{path:ctx.r.path,sourceSha256:fresh.sourceSha256,writeContextProjectUuid:p.expectedProjectUuid,readContextProjectUuid:fresh.project.uuid,schematicPageUuid:p.schematicPageUuid},persistenceVerified:verification.status==='ok'&&verification.comparison?.status==='matched'};
  if(fresh.sourceSha256!==digest(await readFile(ctx.r.path))){result.status='unknown';result.code='SOURCE_CHANGED_DURING_VERIFICATION';result.persistenceVerified=false;}
  ctx.r.reopen=result;await persist(ctx.dir,ctx.r);return result;});
 },
 async jlc_eda_preview_schematic(p){const ctx=await bound(this,p);const r=await this.invoke(p.sessionId,drawingScript({...p,operation:'preview'}));
  if(r.status!=='ok')return r;const file=path.join(ctx.dir,'schematic.'+p.format);await writeFile(file,p.format==='png'?Buffer.from(r.data,'base64'):r.source);return {status:'ok',path:file};}
};

for(const name of ['jlc_eda_create_work_project','jlc_eda_draw_schematic']){
 const operation=workflow[name];workflow[name]=async function(p){try{return await operation.call(this,p);}catch(e){
  const dir=p.workDirectory??p.outputDirectory;
  if(dir&&path.isAbsolute(dir)){const r=await load(dir).catch(()=>null);if(r){e.target??={workDirectory:dir,path:r.path,sessionId:r.sessionId??null,projectUuid:r.projectUuid??null,schematicPageUuid:r.schematicPageUuid??null};e.executionRecord??=path.join(dir,'work-project.json');}}
  throw e;
 }};
}
