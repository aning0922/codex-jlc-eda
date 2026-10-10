import {z} from 'zod';
import {mkdir,realpath,copyFile,readFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import path from 'node:path';
import {circuitSchema,fingerprint} from './drawing.mjs';
import {digest} from './facts.mjs';
import {load,persist} from './workflow.mjs';
import {association,pcbSnapshot,positionDiff,comparePreservedPcbSnapshot} from './pcb.mjs';
import {unresolvedActions} from './pcb-validation.mjs';
import {verifyLayoutSnapshot} from './pcb-validation.mjs';
import {routingScript,compareRoutingCheckpoint,readOwnedRouting} from './p3.mjs';
import {scripts} from './native-scripts.mjs';
import {selectSavedStage} from './saved-stage.mjs';
import {selectKnownPartialStage} from './known-partial-stage.mjs';
import {readRepairSnapshot} from './local-repair.mjs';
import {refreshRepairContinuation} from './repair-context-refresh.mjs';
import {archive} from './finish.mjs';
import {ensureTaskContext} from './task-session.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const sha=z.string().regex(/^[a-f0-9]{64}$/);
export const continuationSchemas={jlc_eda_resume_work_project:z.object({sourceWorkDirectory:z.string().min(1).max(4096),outputDirectory:z.string().min(1).max(4096),requestId:id,phase:z.enum(['resume','refresh_saved','recover_refreshed']).default('resume'),circuit:circuitSchema,repairIntent:z.object({kind:z.literal('local_repair'),sourceFileSha256:sha,sourceJournalSha256:sha,stopRequestId:id,fileRequestId:id,nets:z.array(z.string().min(1)).min(1).max(12),purpose:z.string().min(10).max(1000)}).strict().optional()}).strict()};
const fail=(code,message=code)=>{throw Object.assign(new Error(message),{code,status:'unknown'});};

export async function verifyRecoveredTask(a,r,context){
 const selectedStage=r.continuation?.selectedStage;
 if(r.pcbRepairBaseline&&unresolvedActions(r).length)return {status:'unknown',code:'TASK_RECOVERY_CURRENT_ACTION_UNRESOLVED'};
 if(selectedStage){
  try{
   const file=path.join(path.dirname(r.path),'source-journal.json'),bytes=await readFile(file);
   const select=selectedStage.kind==='known_partial_file_stage'?selectKnownPartialStage:selectSavedStage;
   if(r.continuation.sourceJournalCopy!==file||digest(bytes)!==selectedStage.sourceJournalSha256||r.continuation.sourceCheckpointSha256!==selectedStage.sourceJournalSha256||r.continuation.sourceSha256!==selectedStage.sourceSha256||fingerprint(select(JSON.parse(bytes),{sourcePath:selectedStage.sourcePath,sourceSha256:selectedStage.sourceSha256,sourceJournalSha256:digest(bytes),intent:selectedStage.intent}))!==fingerprint(selectedStage))return {status:'unknown',code:'TASK_RECOVERY_STAGE_SOURCE_CHANGED'};
  }catch(error){return {status:'unknown',code:'TASK_RECOVERY_STAGE_SOURCE_UNVERIFIED',error:{code:error.code??null,message:error.message}};}
 }
 const p={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid,schematicPageUuid:r.schematicPageUuid,schematicUuid:r.schematicUuid,pcbDocumentUuid:r.pcbDocumentUuid,circuit:r.circuit};
 const link=association(context.project,p);if(link.status!=='ok')return link;
 const identity=await a.jlc_eda_verify_pcb(p);if(identity.status!=='ok'||identity.comparison?.status!=='matched')return {status:'unknown',code:'TASK_RECOVERY_DESIGN_UNVERIFIED',identity};
 const doc=identity.pcbDocument;await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));
 const repairRead=r.pcbRepairBaseline?await readRepairSnapshot(a,p,r):null;
 if(repairRead&&repairRead.status!=='ok')return {...repairRead,code:repairRead.code??'TASK_RECOVERY_PARTIAL_STAGE_CHANGED'};
 const native=repairRead?.native??await readOwnedRouting(a,p);
 let layout=null,copper=null;
 if(r.pcbLayoutBaseline){layout=verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline);if(layout.status!=='matched')return {status:'unknown',code:'TASK_RECOVERY_LAYOUT_CHANGED',identity,layout,native};}
 else if(r.pcbSyncBaseline&&positionDiff(r.pcbSyncBaseline.after,pcbSnapshot(doc)).length)return {status:'unknown',code:'TASK_RECOVERY_SYNC_POSE_CHANGED',identity,native};
 const stage=r.continuation?.selectedStage;
 const expected=r.pcbRepairBaseline?.native??stage?.native??r.pcbCopperBaseline?.native;
 if(expected){copper=compareRoutingCheckpoint(expected,native);if(copper.status!=='matched')return {status:'unknown',code:'TASK_RECOVERY_COPPER_CHANGED',identity,layout,copper,native};}
 else if(native.status!=='ok'||native.objects?.some(x=>x.net&&[1,2,12].includes(x.layer)))return {status:'unknown',code:'TASK_RECOVERY_UNRECORDED_COPPER',identity,layout,native};
 let stageComponents=null,stageDesign=null;
 if(stage){
  stageComponents=comparePreservedPcbSnapshot(repairRead?{...stage.document,counts:doc.counts}:stage.document,pcbSnapshot(doc),{expectedProjectUuid:stage.sourceProjectUuid,actualProjectUuid:r.projectUuid});
  stageDesign=await archive(a,p);
  if(stageComponents.status!=='matched'||(!repairRead||r.pcbRepairBaseline.sourceStage)&&fingerprint(stage.design)!==fingerprint(stageDesign))return {status:'unknown',code:'TASK_RECOVERY_SAVED_STAGE_CHANGED',identity,layout,copper,native,stageComponents,stageDesign};
  if(repairRead)r.pcbRepairBaseline.nonCopper??=repairRead.nonCopper;
 }
 return {status:'ok',identity,layout,copper,native,stageComponents,stageDesign,repairReadback:repairRead,selectedCheckpoint:stage?.kind??'historical_copper',preservedActionStates:Object.fromEntries(Object.entries(r.pcbActions??{}).map(([k,v])=>[k,v.state]))};
}

export const continuationWorkflow={async verifyRecoveredTask(r,context){return verifyRecoveredTask(this,r,context);},async jlc_eda_resume_work_project(p){
 if(p.phase&&p.phase!=='resume')return refreshRepairContinuation(this,p);
 if(!path.isAbsolute(p.sourceWorkDirectory)||!path.isAbsolute(p.outputDirectory))fail('ABSOLUTE_DIRECTORY_REQUIRED');
 const sourceDir=await realpath(p.sourceWorkDirectory),source=await load(sourceDir),sourcePath=await realpath(source.path),bytes=await readFile(sourcePath),journalBytes=await readFile(path.join(sourceDir,'work-project.json'));
 if(source.kind!=='task_work_project'||!source.pcbSyncBaseline||!source.pcbLayoutBaseline||fingerprint(source.circuit)!==fingerprint(p.circuit)||!source.openPathConfirmed)fail('CONTINUATION_SAVED_SOURCE_UNVERIFIED');
 const hash=digest(bytes),checkpointHash=digest(journalBytes),selectedStage=(p.repairIntent?selectKnownPartialStage:selectSavedStage)(source,{sourcePath,sourceSha256:hash,sourceJournalSha256:checkpointHash,intent:p.repairIntent}),stopped=Object.values(source.workStops??{}).find(x=>x.state==='closed'&&x.target?.path===sourcePath&&x.target.sessionId===source.sessionId&&x.preservation?.persistenceVerified&&x.preservation.fullDesignArchiveCompared&&x.closed?.sessionNoLongerAlive&&x.closed.editorWindowDestroyed),savedHash=selectedStage?.sourceSha256??(source.pcbReopen?.persistenceVerified?source.pcbReopen.reopened?.sourceSha256:stopped?.preservation.sourceSha256);let r;
 if(!savedHash||(!p.repairIntent&&!source.pcbReopen?.persistenceVerified&&unresolvedActions(source).length))fail('CONTINUATION_SAVED_SOURCE_UNVERIFIED');
 if(savedHash!==hash)fail('CONTINUATION_SAVED_FILE_CHANGED');
 try{await mkdir(p.outputDirectory);}catch(e){if(e.code!=='EEXIST')throw e;r=await load(p.outputDirectory).catch(()=>null);if(!r||r.continuation?.requestId!==p.requestId||r.continuation.sourcePath!==sourcePath||r.continuation.sourceSha256!==hash||r.continuation.sourceCheckpointSha256!==checkpointHash)fail('CONTINUATION_REQUEST_CONFLICT');}
 const dir=await realpath(p.outputDirectory),file=path.join(dir,'work.eprj2');
 if(r?.finish?.state==='closed')return {status:'unknown',code:'CONTINUATION_FINISHED_NO_AUTOMATIC_REOPEN',workDirectory:dir,nativeOpenRequested:false};
 if(!r){
  await this.ensureWorkWindowBudget();await copyFile(sourcePath,file,constants.COPYFILE_EXCL);await copyFile(path.join(sourceDir,'work-project.json'),path.join(dir,'source-journal.json'),constants.COPYFILE_EXCL);
  if(digest(await readFile(file))!==hash||digest(await readFile(sourcePath))!==hash||digest(await readFile(path.join(sourceDir,'work-project.json')))!==checkpointHash)fail('CONTINUATION_SOURCE_CHANGED_DURING_COPY');
  r=structuredClone(source);r.kind='continuation_pending';r.path=file;r.sessionId=null;r.projectUuid=null;r.openPathConfirmed=false;r.bindingStatus='verification_pending';
  r.continuation={requestId:p.requestId,sourceDirectory:sourceDir,sourcePath,sourceSha256:hash,sourceCheckpointSha256:checkpointHash,copiedSha256:hash,sourceBinding:{sessionId:source.sessionId,projectUuid:source.projectUuid,path:sourcePath},sourceJournalCopy:path.join(dir,'source-journal.json'),...(selectedStage?{selectedStage}:{}),startedAt:new Date().toISOString()};
  if(selectedStage?.kind==='known_partial_file_stage')r.pcbRepairBaseline={predecessorFingerprint:fingerprint(selectedStage),native:selectedStage.native,document:selectedStage.document,storedCopper:selectedStage.storedCopper,padModels:selectedStage.padModels,nativeRules:selectedStage.nativeRules,sourceStage:true};
  // Opening provenance is separate; old openAttempt and every old action stay intact.
  delete r.taskOpenAttempt;await persist(dir,r);
 }
 const context=await ensureTaskContext(this,dir,r);if(context.status!=='ok')return {...context,workDirectory:dir,executionRecord:path.join(dir,'work-project.json')};
 const verification=await this.verifyRecoveredTask(r,context);r.continuation.lastVerification=verification;await persist(dir,r);
 if(verification.status!=='ok')return {...verification,workDirectory:dir};
 if(digest(await readFile(sourcePath))!==hash||digest(await readFile(path.join(sourceDir,'work-project.json')))!==checkpointHash)fail('CONTINUATION_SOURCE_CHANGED_DURING_VERIFICATION');
 r.kind='task_work_project';r.bindingStatus='verified';r.continuation.verifiedAt=new Date().toISOString();await persist(dir,r);
 return {status:'ok',workDirectory:dir,path:file,sessionId:r.sessionId,projectUuid:r.projectUuid,schematicPageUuid:r.schematicPageUuid,schematicUuid:r.schematicUuid,pcbDocumentUuid:r.pcbDocumentUuid,continuation:r.continuation,preservedActionStates:verification.preservedActionStates,reused:context.reused,inspectionCopy:false};
}};
