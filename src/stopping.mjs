import {z} from 'zod';
import {realpath,readFile} from 'node:fs/promises';
import {load,persist,bound} from './workflow.mjs';
import {fingerprint,circuitSchema} from './drawing.mjs';
import {digest} from './facts.mjs';
import {archive} from './finish.mjs';
import {withFreshRead,resourceIdentityScript,resourceAnchorPath} from './resources.mjs';
import {unresolvedActions,confirmedTerminatedAction,confirmedFailedStageAction} from './pcb-validation.mjs';
import {readOwnedRouting,compareRoutingCheckpoint} from './p3.mjs';
import {pcbSnapshot,comparePreservedPcbSnapshot} from './pcb.mjs';
import {ruleCheckpointEqual} from './rules.mjs';
import {preserveFileStage} from './file-stage-preservation.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const stoppingSchemas={jlc_eda_stop_work_project:z.object({sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,schematicUuid:id,pcbDocumentUuid:id,workDirectory:z.string().min(1).max(4096),requestId:id,routeRequestId:id,mode:z.enum(['native_timeout','rolled_back_ui','file_partial']).default('native_timeout'),circuit:circuitSchema}).strict()};
const unknown=(code,extra={})=>({status:'unknown',code,editorWindowDestroyed:false,...extra});
function finishTermination(r,stop,action,closed){
 stop.state='closed';stop.closed=closed;stop.finishedAt=new Date().toISOString();
 if(stop.mode==='rolled_back_ui'){
  action.state='failed_preserved';action.failurePreservation={outcome:'rolled_back_ui_route_not_success',operationSucceeded:false,designReady:false,method:'official owned session close --destroy after failed-stage preservation',targetSessionId:stop.target.sessionId,targetPath:stop.target.path,preservation:stop.preservation,closed,at:stop.finishedAt};
  return {status:'ok',operationEnded:true,operationSucceeded:false,outcome:'rolled_back_ui_route_not_success',persistenceVerified:true,fullDesignArchiveCompared:true,editorWindowDestroyed:true,designReady:false,preservedStageOnly:true,preservation:stop.preservation,closed,path:r.path,requestState:'failed_preserved'};
 }
 action.state='terminated';action.termination={previousState:'unknown',outcome:'unknown_not_success',executionEnded:true,method:'official owned session close --destroy',targetSessionId:stop.target.sessionId,targetPath:stop.target.path,preservation:stop.preservation,closed,at:stop.finishedAt};
 return {status:'ok',operationEnded:true,operationSucceeded:false,outcome:'unknown_not_success',persistenceVerified:true,fullDesignArchiveCompared:true,editorWindowDestroyed:true,designReady:false,preservation:stop.preservation,closed,path:r.path,requestState:'terminated'};
}
export const stoppingWorkflow={async jlc_eda_stop_work_project(p){
 if(p.mode==='file_partial')return preserveFileStage(this,p);
 const dir=await realpath(p.workDirectory),r=await load(dir),key='route/'+p.routeRequestId,action=r.pcbActions?.[key],hash=fingerprint(p);
 if(r.kind!=='task_work_project'||r.path!==await realpath(r.path)||r.sessionId!==p.sessionId||r.projectUuid!==p.expectedProjectUuid||r.schematicPageUuid!==p.schematicPageUuid||r.schematicUuid!==p.schematicUuid||r.pcbDocumentUuid!==p.pcbDocumentUuid||fingerprint(r.circuit)!==fingerprint(p.circuit))return unknown('STOP_TARGET_OR_INPUT_MISMATCH');
 r.workStops??={};let stop=r.workStops[p.requestId];if(stop&&stop.hash!==hash)return unknown('STOP_REQUEST_CONFLICT');
 if(stop?.state==='closed')return (stop.mode==='rolled_back_ui'?confirmedFailedStageAction(action):confirmedTerminatedAction(action))?{status:'ok',...stop.result,reused:true}:unknown('STOP_TERMINATION_PROOF_MISSING');
 // After an uncertain destroy, reconcile only the original context. Never replay close.
 if(stop?.state==='pending_close'||stop?.state==='close_unknown'){
  const sessions=await this.jlc_eda_sessions();if(sessions.status!=='ok'||sessions.sessions.some(s=>s.sessionId===p.sessionId&&s.status==='alive'))return unknown('STOP_CLOSE_OUTCOME_UNKNOWN',{stop});
  if(!stop.preservation?.persistenceVerified||digest(await readFile(r.path))!==stop.preservation.sourceSha256)return unknown('STOP_SAVED_FILE_CHANGED_AFTER_CLOSE',{stop});
  const closed={status:'ok',sessionNoLongerAlive:true,editorWindowDestroyed:true,nativeDestroyRequested:true,reconciled:true,sessionId:p.sessionId};stop.result=finishTermination(r,stop,action,closed);await persist(dir,r);return stop.result;
 }
 const failedUi=p.mode==='rolled_back_ui';
 if(failedUi){
  if(!action||action.phase!=='prepare_ui'||action.state!=='invalidated'||!action.invalidation||!action.afterNative||action.result?.status!=='ok'||action.nativeResult?.code!=='PCB_NATIVE_ROUTING_UI_REQUIRED'||!action.beforeNative||action.lastReadback?.code!=='PCB_ROUTING_NOT_APPLIED_OR_OUTCOME_UNKNOWN'||!(action.afterNative.objects?.length>action.beforeNative.objects?.length))return unknown('STOP_ROLLED_BACK_UI_ROUTE_REQUIRED');
 }else if(!action||action.phase!=='native'||action.state!=='unknown'||!['REQUEST_TIMEOUT','CLI_TIMEOUT'].includes(action.error?.code))return unknown('STOP_UNKNOWN_NATIVE_ROUTE_REQUIRED');
 const unresolved=unresolvedActions(r);if(unresolved.length!==1||unresolved[0].scope!=='pcb'||unresolved[0].key!==key)return unknown('STOP_OTHER_ACTIONS_UNRESOLVED',{unresolvedActions:unresolved});
 await bound(this,p);const identity=await this.invoke(p.sessionId,resourceIdentityScript);
 if(identity.status!=='ok'||resourceAnchorPath(identity.anchor)!==r.path||identity.projectUuid!==p.expectedProjectUuid)return unknown('STOP_LIVE_PATH_UNCONFIRMED');
 const owned=(await this.resources.all()).find(x=>x.kind==='work'&&x.path===r.path&&x.sessionId===p.sessionId);
 if(!owned)return unknown('STOP_RESOURCE_OWNERSHIP_UNCONFIRMED');
 if(!this.resources.entries.has(p.sessionId))await this.registerWorkSession({sessionId:p.sessionId,path:r.path,workDirectory:dir,recoveredFromOwner:owned.ownerId});
 let stageComparison=null;
 if(failedUi){
  const native=await readOwnedRouting(this,p),doc=await this.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
  const copper=compareRoutingCheckpoint(action.beforeNative,native),components=doc.status==='ok'?comparePreservedPcbSnapshot(action.before,pcbSnapshot(doc)):{status:'unknown',issues:[{code:'STOP_STAGE_DOCUMENT_UNAVAILABLE'}]};
  stageComparison={status:copper.status==='matched'&&components.status==='matched'?'matched':'mismatch',copper,components};
  if(stageComparison.status!=='matched')return unknown('STOP_ROLLBACK_STAGE_CHANGED',{rollbackStageComparison:stageComparison});
 }
 stop={hash,state:'verifying',mode:p.mode,target:{sessionId:p.sessionId,path:r.path,projectUuid:p.expectedProjectUuid},originalActionFingerprint:fingerprint(action),startedAt:new Date().toISOString()};r.workStops[p.requestId]=stop;await persist(dir,r);
 const saved=await this.jlc_eda_save_work_project({...p,requestId:p.requestId+'-save'});
 // A separate preservation expectation: never replace the accepted 104-object
 // checkpoint in the durable record with the 17-object failed stage.
 const expected=failedUi?{...r,pcbCopperBaseline:{after:action.before,native:action.beforeNative}}:r;
 // Failed-stage preservation proves saved design, not a stable/zero DRC result.
 // Retain strict DRC comparison and both trees, without widening its tolerance.
 // Native-timeout and ordinary finish continue requiring identical DRC results.
 const verify=async t=>{const v=await this.verifyP3Checkpoint(t,expected,{preservationOnly:true,drcConsistencyRequired:!failedUi});if(failedUi){v.rollbackStageComparison=v.document?comparePreservedPcbSnapshot(action.before,pcbSnapshot(v.document),{expectedProjectUuid:p.expectedProjectUuid,actualProjectUuid:t.expectedProjectUuid}):{status:'unknown',issues:[{code:'STOP_STAGE_DOCUMENT_UNAVAILABLE'}]};const issues=[...v.rollbackStageComparison.issues];if(v.drc?.status!=='ok'||!ruleCheckpointEqual(v.drc.beforeRules,v.drc.afterRules))issues.push({code:'STOP_STAGE_STRICT_DRC_UNAVAILABLE_OR_RULES_CHANGED'});if(issues.length)v.comparison={...v.comparison,status:'mismatch',issues:[...(v.comparison?.issues??[]),...issues]};}return v;};
 const live=await verify(p);if(live.status!=='ok'||live.comparison?.status!=='matched')return unknown('STOP_LIVE_DESIGN_UNVERIFIED',{saved,live});
 const before=await archive(this,p),sourceSha256=digest(await readFile(r.path));
 const disk=await withFreshRead(this,r.path,async fresh=>{
  if(fresh.status!=='ok'||!fresh.freshDiskContext||fresh.reusedOwnedSession||!fresh.inspectionCopy||fresh.sessionId===p.sessionId||fresh.path===r.path||fresh.sourcePath!==r.path||fresh.sourceSha256!==sourceSha256||!id.safeParse(fresh.project?.uuid).success)return {status:'unknown',code:'STOP_FRESH_CONTEXT_UNCERTAIN',persistenceVerified:false,reopened:fresh};
  const target={...p,sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid},verified=await verify(target),design=await archive(this,target);
  return {...verified,design,reopened:fresh,persistenceVerified:verified.status==='ok'&&verified.comparison?.status==='matched'&&fingerprint(before)===fingerprint(design)};
 });
 const after=await archive(this,p),sourceUnchanged=sourceSha256===digest(await readFile(r.path));
 const preservation={saved,live,disk,before,after,sourceSha256,sourceUnchanged,persistenceVerified:disk.persistenceVerified===true&&disk.resourceCleanup?.status==='ok'&&fingerprint(before)===fingerprint(after)&&sourceUnchanged,fullDesignArchiveCompared:!!disk.design&&fingerprint(before)===fingerprint(disk.design)&&fingerprint(before)===fingerprint(after),designReady:false,operationStillUnresolved:true,...(failedUi?{rollbackStageComparison:stageComparison,acceptedRoutingCheckpointPreserved:true,stageBaseline:{native:action.beforeNative,document:action.before}}:{})};
 // Save may append its own journal entry: merge instead of overwriting it.
 const latest=await load(dir);if(fingerprint(latest.pcbActions?.[key])!==stop.originalActionFingerprint)return unknown('STOP_ACTION_CHANGED_DURING_VERIFICATION',{preservation});r.pcbSaveAttempt=latest.pcbSaveAttempt;stop.preservation=preservation;await persist(dir,r);
 if(!preservation.persistenceVerified||!preservation.fullDesignArchiveCompared)return unknown('STOP_PRESERVATION_UNVERIFIED',{preservation});
 // Check path and complete live archive once more immediately before destroy.
 const current=await this.invoke(p.sessionId,resourceIdentityScript);if(resourceAnchorPath(current.anchor)!==r.path||current.projectUuid!==p.expectedProjectUuid||fingerprint(await archive(this,p))!==fingerprint(before)||digest(await readFile(r.path))!==sourceSha256)return unknown('STOP_TARGET_CHANGED_BEFORE_CLOSE',{preservation});
 stop.state='pending_close';await persist(dir,r);let closed;
 try{closed=await this.destroyOwnedSession(p.sessionId,{workVerified:true});}catch(e){closed={status:'unknown',code:e.code,message:e.message};}
 if(closed.status!=='ok'||!closed.sessionNoLongerAlive||!closed.editorWindowDestroyed){stop.state='close_unknown';stop.closed=closed;await persist(dir,r);return unknown('STOP_CLOSE_UNCONFIRMED',{preservation,closed});}
 if(digest(await readFile(r.path))!==sourceSha256){stop.state='close_unknown';stop.closed=closed;await persist(dir,r);return unknown('STOP_SAVED_FILE_CHANGED_AFTER_CLOSE',{preservation,closed});}
 stop.result=finishTermination(r,stop,action,closed);await persist(dir,r);return stop.result;
}};
