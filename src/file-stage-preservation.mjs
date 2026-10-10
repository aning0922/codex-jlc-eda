// Preserve a known returned, read-back partial file import as a failed stage.
// It remains unresolved for writing; closing never grants route success/replay.
import path from 'node:path';import {realpath,readFile} from 'node:fs/promises';import {load,persist} from './workflow.mjs';import {fingerprint} from './drawing.mjs';import {digest} from './facts.mjs';import {pcbBound,pcbSnapshot} from './pcb.mjs';import {unresolvedActions} from './pcb-validation.mjs';import {losslessView,verifyFileRoute,readNativeEvidence} from './file-checkpoint.mjs';import {compareRoutingCheckpoint} from './p3.mjs';import {ruleCheckpointEqual} from './rules.mjs';import {compareRulesWithEvidence} from './native-rule-evidence.mjs';import {archive} from './finish.mjs';import {withFreshRead,resourceIdentityScript,resourceAnchorPath} from './resources.mjs';
import {reconcileStageApiProjection} from './stage-api-projection.mjs';import {compareFilePreservation} from './file-preservation.mjs';
const bad=(code,extra={})=>({status:'unknown',code,designReady:false,operationSucceeded:false,editorWindowDestroyed:false,...extra});
const same=(a,b)=>fingerprint(a)===fingerprint(b),history=r=>fingerprint({pcbCopperBaseline:r.pcbCopperBaseline,pcbActions:r.pcbActions,workStops:r.workStops,pcbFileRouteBaseline:r.pcbFileRouteBaseline,selectedSourceStage:r.continuation?.selectedStage});
function qualifiedPartial(v){return v?.status==='ok'&&v.comparison?.status==='mismatch'&&v.comparison.issues?.length>0&&v.comparison.issues.every(x=>['FILE_STRICT_DRC_FAILED','FILE_COPPER_NOT_CONNECTED'].includes(x.code))&&['preserved','components','layout','rules','scope','drcStable','drcEvidenceStable','sourceModels'].every(k=>v[k]?.status==='matched')&&v.drc?.status==='ok'&&v.drc.strict===true&&Array.isArray(v.drc.errors)&&ruleCheckpointEqual(v.drc.beforeRules,v.drc.afterRules)&&ruleCheckpointEqual(v.native?.ruleConfiguration,v.drc.beforeRules)&&v.rulesMatched===true&&v.designReady===false;}
const validClosed=s=>s?.state==='closed'&&s.closed?.status==='ok'&&s.closed.sessionId===s.target?.sessionId&&s.closed.sessionNoLongerAlive===true&&s.closed.editorWindowDestroyed===true&&s.preservation?.persistenceVerified===true&&s.preservation.fullDesignArchiveCompared===true&&s.preservation.designReady===false;
export async function preserveFileStage(adapter,p){
 const a=losslessView(adapter),dir=await realpath(p.workDirectory),r=await load(dir),hash=fingerprint(p),action=r.fileRouteActions?.[p.routeRequestId];
 if(r.kind!=='task_work_project'||r.bindingStatus!=='verified'||r.path!==await realpath(r.path)||r.sessionId!==p.sessionId||r.projectUuid!==p.expectedProjectUuid||r.schematicPageUuid!==p.schematicPageUuid||r.schematicUuid!==p.schematicUuid||r.pcbDocumentUuid!==p.pcbDocumentUuid||!same(r.circuit,p.circuit))return bad('FILE_STAGE_TARGET_MISMATCH');
 r.fileStageStops??={};let stop=r.fileStageStops[p.requestId];
 if(stop&&stop.hash!==hash)return bad('FILE_STAGE_REQUEST_CONFLICT');
 if(stop?.state==='closed')return validClosed(stop)&&digest(await readFile(r.path))===stop.preservation.sourceSha256?{...stop.result,reused:true}:bad('FILE_STAGE_CLOSED_PROOF_CHANGED');
 if(stop&&['pending_close','close_unknown'].includes(stop.state))return bad('FILE_STAGE_CLOSE_UNKNOWN_NO_REPLAY',{stop,nativeCloseReplayed:false});
 if(!action||action.state!=='unknown'||action.invalidation||action.applyAttempts!==1||action.nativeResult?.status!=='ok'||action.nativeResult.nativeResult!==true||action.nativeResult.nativeMethodCalled!==true||!qualifiedPartial(action.lastReadback)||r.pcbFileRouteBaseline)return bad('FILE_STAGE_KNOWN_PARTIAL_IMPORT_REQUIRED');
 const unresolved=unresolvedActions(r);if(unresolved.length!==1||unresolved[0].scope!=='file'||unresolved[0].key!==p.routeRequestId)return bad('FILE_STAGE_OTHER_ACTION_UNRESOLVED',{unresolvedActions:unresolved});
 await pcbBound(a,p);const identity=await a.invoke(p.sessionId,resourceIdentityScript);
 if(identity.status!=='ok'||identity.projectUuid!==r.projectUuid||resourceAnchorPath(identity.anchor)!==r.path)return bad('FILE_STAGE_LIVE_PATH_UNCONFIRMED');
 const owned=(await a.resources.all()).find(x=>x.kind==='work'&&x.path===r.path&&x.sessionId===p.sessionId);if(!owned)return bad('FILE_STAGE_RESOURCE_OWNERSHIP_UNCONFIRMED');
 if(!a.resources.entries.has(p.sessionId))await a.registerWorkSession({sessionId:p.sessionId,path:r.path,workDirectory:dir,recoveredFromOwner:owned.ownerId});
 const sourceHistory=history(r),actionFingerprint=fingerprint(action),initial=await verifyFileRoute(a,p,r,action,{reconcileSource:false});
 if(!qualifiedPartial(initial)||compareRoutingCheckpoint(action.lastReadback.native,initial.native).status!=='matched'||initial.storedCopper.sha256!==action.lastReadback.storedCopper.sha256||!same(initial.drcEvidenceStable.beforeDesign,action.lastReadback.drcEvidenceStable.afterDesign))return bad('FILE_STAGE_PARTIAL_CONTENT_CHANGED',{initial});
 const attempts=stop?[...(stop.attemptHistory??[]),{...stop,attemptHistory:undefined}]:[];
 stop={attemptHistory:attempts,hash,state:'verifying',target:{sessionId:p.sessionId,projectUuid:r.projectUuid,path:r.path},fileRequestId:p.routeRequestId,actionFingerprint,sourceHistoryFingerprint:sourceHistory,startedAt:new Date().toISOString()};r.fileStageStops[p.requestId]=stop;await persist(dir,r);
 const saved=await a.jlc_eda_save_work_project({...p,requestId:p.requestId+'-save'}),live=await verifyFileRoute(a,p,r,action,{reconcileSource:false});
 if(!qualifiedPartial(live)||compareRoutingCheckpoint(initial.native,live.native).status!=='matched')return bad('FILE_STAGE_LIVE_CHANGED_DURING_SAVE',{saved,live});
 const before=await archive(a,p),sourceSha256=digest(await readFile(r.path));
 const disk=await withFreshRead(a,r.path,async fresh=>{
  if(fresh.status!=='ok'||!fresh.freshDiskContext||fresh.reusedOwnedSession||!fresh.inspectionCopy||fresh.sessionId===p.sessionId||fresh.path===r.path||fresh.sourcePath!==r.path||fresh.sourceSha256!==sourceSha256||!fresh.project?.uuid)return bad('FILE_STAGE_FRESH_CONTEXT_UNCERTAIN',{reopened:fresh});
  const target={...p,sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid},verified=await verifyFileRoute(a,target,r,action,{reconcileSource:false}),design=await archive(a,target),copper=verified.native?compareRoutingCheckpoint(live.native,verified.native,{compareRules:false}):{status:'unknown'},rules=compareRulesWithEvidence(live.native.ruleConfiguration,verified.native?.ruleConfiguration,{expectedNative:live.nativeRules,actualNative:verified.nativeRules,allowProjection:true});
  let stageProjection=null,stageKeep=null,stageQualified=qualifiedPartial(verified),stageCopper=copper;
  if(copper.status!=='matched'&&same(before,design)&&live.storedCopper.sha256===verified.storedCopper?.sha256){
   const evidence=await readNativeEvidence(a,target,{native:verified.native,document:verified.document});
   if(same(evidence.design,verified.drcEvidenceStable?.afterDesign)){
    stageProjection=reconcileStageApiProjection({expected:live.native,actual:verified.native,storedBefore:live.storedCopper,storedAfter:verified.storedCopper,archiveData:evidence.data,document:verified.document});
    if(stageProjection.status==='matched'){
     stageKeep=compareFilePreservation(action.before.native,stageProjection.native,{policy:action.plan.policy,storedBefore:action.beforeCopper,storedAfter:verified.storedCopper});
     stageQualified=qualifiedPartial({...verified,preserved:stageKeep,comparison:{...verified.comparison,issues:verified.comparison.issues.filter(x=>x.code!=='FILE_PRESERVED_MISMATCH')}});
     stageCopper=stageProjection.comparison??copper;
    }
   }
  }
  return {...verified,design,reopened:fresh,apiCopperComparison:copper,stageCopperComparison:stageCopper,stageRuleComparison:rules,stageApiProjection:stageProjection,stagePhysicalKeep:stageKeep,stageQualificationOnly:stageQualified,persistenceVerified:stageQualified&&stageCopper.status==='matched'&&rules.status==='matched'&&live.storedCopper.sha256===verified.storedCopper.sha256&&same(before,design)};
 });
 const after=await archive(a,p),sourceUnchanged=sourceSha256===digest(await readFile(r.path));
 const preservation={saved,live,disk,before,after,sourceSha256,sourceUnchanged,persistenceVerified:disk.persistenceVerified===true&&disk.resourceCleanup?.status==='ok'&&disk.resourceCleanup.sessionNoLongerAlive===true&&same(before,after)&&sourceUnchanged,fullDesignArchiveCompared:!!disk.design&&same(before,disk.design)&&same(before,after),stageBaseline:{native:live.native,document:pcbSnapshot(live.document),storedCopper:live.storedCopper,padModels:live.padModels,nativeRules:live.nativeRules},designReady:false,operationSucceeded:false,originalHistoryPreserved:true,fileRequestStillUnresolved:true,strictDrcCompared:true,drcResultsAcrossContextsMayDiffer:true};
 const latest=await load(dir);if(history(latest)!==sourceHistory||fingerprint(latest.fileRouteActions?.[p.routeRequestId])!==actionFingerprint)return bad('FILE_STAGE_JOURNAL_CHANGED',{preservation});
 r.pcbSaveAttempt=latest.pcbSaveAttempt;stop.preservation=preservation;await persist(dir,r);
 if(!preservation.persistenceVerified||!preservation.fullDesignArchiveCompared)return bad('FILE_STAGE_DISK_UNVERIFIED',{preservation});
 const current=await a.invoke(p.sessionId,resourceIdentityScript);if(current.projectUuid!==r.projectUuid||resourceAnchorPath(current.anchor)!==r.path||!same(await archive(a,p),before)||digest(await readFile(r.path))!==sourceSha256)return bad('FILE_STAGE_TARGET_CHANGED_BEFORE_CLOSE',{preservation});
 stop.state='pending_close';await persist(dir,r);let closed;try{closed=await a.destroyOwnedSession(p.sessionId,{workVerified:true});}catch(e){closed={status:'unknown',code:e.code,message:e.message};}
 stop.closed=closed;if(closed.status!=='ok'||closed.sessionId!==p.sessionId||!closed.sessionNoLongerAlive||!closed.editorWindowDestroyed||digest(await readFile(r.path))!==sourceSha256){stop.state='close_unknown';await persist(dir,r);return bad('FILE_STAGE_CLOSE_UNKNOWN_NO_REPLAY',{preservation,closed});}
 stop.state='closed';stop.finishedAt=new Date().toISOString();action.failedStagePreservation={state:'closed',outcome:'partial_file_route_not_success',targetPath:r.path,targetSessionId:p.sessionId,preservation,closed,at:stop.finishedAt};
 // Deliberately retain state=unknown: stage closing does not unblock any write.
 stop.result={status:'ok',operationEnded:true,operationSucceeded:false,designReady:false,preservedStageOnly:true,persistenceVerified:true,fullDesignArchiveCompared:true,editorWindowDestroyed:true,fileRequestStillUnresolved:true,outcome:'partial_file_route_not_success',preservation,closed,path:r.path,executionRecord:path.join(dir,'work-project.json')};await persist(dir,r);return stop.result;
}
