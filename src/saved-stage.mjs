// A closed failed stage is a distinct saved checkpoint. Historical successful
// copper and the original failure records never become this continuation's goal.
import {fingerprint} from './drawing.mjs';
import {confirmedFailedStageAction,unresolvedActions} from './pcb-validation.mjs';
import {compareRoutingCheckpoint} from './p3.mjs';
import {pcbSnapshot,comparePreservedPcbSnapshot} from './pcb.mjs';
import {ruleCheckpointEqual} from './rules.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:'unknown'});};
const exact=(a,b)=>!!a&&!!b&&fingerprint(a)===fingerprint(b);
const strictDrc=v=>v?.drc?.status==='ok'&&v.drc.strict===true&&Array.isArray(v.drc.errors)&&ruleCheckpointEqual(v.drc.beforeRules,v.drc.afterRules);
export function selectSavedStage(source,{sourcePath,sourceSha256,sourceJournalSha256}){
 const failed=Object.entries(source.pcbActions??{}).filter(([key,a])=>key.startsWith('route/')&&a.state==='failed_preserved');
 if(!failed.length)return null;
 if(unresolvedActions(source).length)fail('CONTINUATION_STAGE_ACTION_UNRESOLVED');
 const candidates=[];
 for(const [stopId,stop]of Object.entries(source.workStops??{})){
  if(stop.mode!=='rolled_back_ui'||stop.state!=='closed'||stop.target?.path!==sourcePath||stop.target.sessionId!==source.sessionId||stop.target.projectUuid!==source.projectUuid)continue;
  const p=stop.preservation,c=stop.closed;
  if(!p||p.sourceSha256!==sourceSha256)continue;
  if(c?.status!=='ok'||c.sessionId!==source.sessionId||c.sessionNoLongerAlive!==true||c.editorWindowDestroyed!==true||p.sourceUnchanged!==true||p.persistenceVerified!==true||p.fullDesignArchiveCompared!==true||p.designReady!==false||p.acceptedRoutingCheckpointPreserved!==true||p.rollbackStageComparison?.status!=='matched'||!exact(p.before,p.after)||!exact(p.before,p.disk?.design)||p.disk?.persistenceVerified!==true||p.disk.resourceCleanup?.status!=='ok'||p.disk.resourceCleanup.sessionNoLongerAlive!==true||p.disk.reopened?.sourcePath!==sourcePath||p.disk.reopened.sourceSha256!==sourceSha256||p.disk.reopened.freshDiskContext!==true||p.disk.reopened.inspectionCopy!==true||p.disk.reopened.reusedOwnedSession!==false||!strictDrc(p.live)||!strictDrc(p.disk))fail('CONTINUATION_STAGE_PRESERVATION_INCOMPLETE');
  const matches=failed.filter(([,a])=>confirmedFailedStageAction(a)&&a.failurePreservation.targetPath===sourcePath&&a.failurePreservation.targetSessionId===source.sessionId&&exact(a.failurePreservation.preservation,p)&&exact(a.failurePreservation.closed,c));
  if(matches.length!==1)fail('CONTINUATION_STAGE_ACTION_BINDING_UNPROVEN');
  const [actionKey,action]=matches[0],original=structuredClone(action);delete original.failurePreservation;original.state='invalidated';
  const stage=p.stageBaseline;
  if(fingerprint(original)!==stop.originalActionFingerprint||!exact(stage?.native,action.beforeNative)||!exact(stage?.document,action.before)||!stage.native?.objects?.length||!stage.document?.components?.length||!p.before?.schematic?.sha256||!p.before?.pcb?.sha256)fail('CONTINUATION_STAGE_ORIGIN_UNPROVEN');
  for(const view of [p.live,p.disk]){
   if(view.status!=='ok'||view.comparison?.status!=='matched'||view.layout?.status!=='matched'||view.rulesMatched!==true||view.rollbackStageComparison?.status!=='matched'||compareRoutingCheckpoint(stage.native,view.native).status!=='matched'||comparePreservedPcbSnapshot(stage.document,pcbSnapshot(view.document),{expectedProjectUuid:source.projectUuid,actualProjectUuid:view.document.projectUuid}).status!=='matched')fail('CONTINUATION_STAGE_SAVED_READBACK_UNPROVEN');
  }
  if(!ruleCheckpointEqual(stage.native.ruleConfiguration,source.pcbRuleBaseline))fail('CONTINUATION_STAGE_RULE_BASELINE_CHANGED');
  candidates.push({kind:'closed_failed_stage',stopId,actionKey,sourcePath,sourceSha256,sourceJournalSha256,sourceProjectUuid:source.projectUuid,sourceSessionId:source.sessionId,proofFingerprint:fingerprint(stop),historicalCopperFingerprint:fingerprint(source.pcbCopperBaseline),historicalActionFingerprint:fingerprint(action),native:stage.native,document:stage.document,design:p.before,reason:'Complete closed failed-stage preservation matches saved source bytes and journal; historical accepted copper remains intact',designReady:false});
 }
 if(candidates.length!==1)fail('CONTINUATION_STAGE_SAVED_SOURCE_UNVERIFIED');
 return candidates[0];
}
