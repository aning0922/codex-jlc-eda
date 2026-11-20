// A closed failed stage is a distinct saved checkpoint. Historical successful
// copper and the original failure records never become this continuation's goal.
import {fingerprint} from './drawing.mjs';
import {confirmedFailedStageAction,unresolvedActions,verifyLayoutSnapshot} from './pcb-validation.mjs';
import {isOwnedFootprintVia} from './footprint-vias.mjs';
import {provenPlanes} from './copper-surface.mjs';
import {compareRoutingCheckpoint} from './p3.mjs';
import {pcbSnapshot,comparePreservedPcbSnapshot,recordedPageIds} from './pcb.mjs';
import {ruleCheckpointEqual} from './rules.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:'unknown'});};
const exact=(a,b)=>!!a&&!!b&&fingerprint(a)===fingerprint(b);
const strictDrc=v=>v?.drc?.status==='ok'&&v.drc.strict===true&&Array.isArray(v.drc.errors)&&ruleCheckpointEqual(v.drc.beforeRules,v.drc.afterRules);
function closedLayoutStage(source,origin){
 const f=source.finish,d=f.disk,opened=d?.reopened,closed=f.closed,layout=source.pcbLayoutBaseline;
 if(!layout.plan?.poses?.length||!layout.plan.input||!layout.outline?.length||
    source.path!==origin.sourcePath||f.sourceSha256!==origin.sourceSha256||
    closed?.status!=='ok'||closed.sessionId!==source.sessionId||!closed.sessionNoLongerAlive||!closed.editorWindowDestroyed||
    d?.status!=='ok'||!d.persistenceVerified||d.comparison?.status!=='matched'||d.identity?.comparison?.status!=='matched'||
    opened?.sourcePath!==origin.sourcePath||opened.sourceSha256!==f.sourceSha256||!opened.freshDiskContext||
    !opened.inspectionCopy||opened.reusedOwnedSession!==false||!opened.sessionId||opened.sessionId===source.sessionId||
    opened.project?.uuid!==d.document?.projectUuid||d.document?.documentUuid!==source.pcbDocumentUuid||
    d.resourceCleanup?.sessionId!==opened.sessionId||d.resourceCleanup.status!=='ok'||!d.resourceCleanup.sessionNoLongerAlive||
    !f.design?.schematic?.sha256||!f.design?.pcb?.sha256||!exact(f.design,d.design)||
    !strictDrc(d)||!Array.isArray(d.native?.objects)||!d.native.ruleConfiguration||!ruleCheckpointEqual(d.drc.beforeRules,d.native.ruleConfiguration)||
    d.document?.truncated!==false||!d.document.components?.length||d.document.counts?.components!==d.document.components.length||
    unresolvedActions(source).length)fail('CONTINUATION_CLOSED_LAYOUT_UNVERIFIED');
 const verified=verifyLayoutSnapshot(layout.plan,d.document,d.native,layout.outline);
 if(verified.status!=='matched')fail('CONTINUATION_CLOSED_LAYOUT_UNVERIFIED');
 const mechanical=new Set([...verified.board.outline,...(verified.board.mountingHoles??[])].map(x=>x.primitiveId));
 const routing=d.native.objects.filter(x=>!mechanical.has(x.primitiveId)&&!isOwnedFootprintVia(x));
 const accepted=source.pcbCopperBaseline;
 if(source.addedSheet){
  const sheet=source.addedSheet,prior=source.continuation?.selectedStage?.design;
  const oldPages=prior?.schematicPages??{[source.schematicPageUuid]:prior?.schematic};
  const ids=recordedPageIds(source),expected={...oldPages,[sheet.uuid]:sheet.accepted?.newSchematic};
  if(!sheet.uuid||!sheet.accepted?.newSchematic?.sha256||!accepted||new Set(ids).size!==ids.length||
     !exact(expected,f.design.schematicPages)||!exact(sheet.accepted.pcb,f.design.pcb)||
     !exact(f.design.schematic,f.design.schematicPages?.[source.schematicPageUuid]))fail('CONTINUATION_CLOSED_SHEETS_UNVERIFIED');
 }else if(source.continuation?.selectedStage?.design?.schematicPages){
  const prior=source.continuation.selectedStage.design.schematicPages;
  if(!exact(prior,f.design.schematicPages)||!exact(prior,accepted?.archives?.schematicPages))fail('CONTINUATION_CLOSED_SHEETS_UNVERIFIED');
 }
 if(accepted){
  try{provenPlanes(routing);}catch{fail('CONTINUATION_CLOSED_PLANE_UNVERIFIED');}
  const supported=x=>['Pour','Poured'].includes(x.kind)||x.net&&(x.kind==='Line'&&[1,2].includes(x.layer)||x.kind==='Via'&&x.viaType===0&&[x.x,x.y,x.diameter,x.holeDiameter].every(Number.isFinite)&&x.diameter>x.holeDiameter&&x.holeDiameter>0);
  if(!routing.length||routing.some(x=>!supported(x))||
     d.copperCheckpoint?.status!=='matched'||d.fullArchive?.status!=='matched'||
     !exact(accepted.archives?.pcb,d.design.pcb)||!exact(accepted.archives?.schematic,d.design.schematic)||
     compareRoutingCheckpoint(accepted.native,d.native).status!=='matched')fail('CONTINUATION_CLOSED_COPPER_UNVERIFIED');
 }else if(routing.length)fail('CONTINUATION_LAYOUT_ALREADY_ROUTED');
 return {kind:accepted?'closed_routed_layout':'closed_unrouted_layout',sourcePath:origin.sourcePath,sourceSha256:origin.sourceSha256,sourceJournalSha256:origin.sourceJournalSha256,
  sourceProjectUuid:d.document.projectUuid,sourceSessionId:source.sessionId,document:pcbSnapshot(d.document),native:d.native,design:f.design};
}
export function selectSavedStage(source,{sourcePath,sourceSha256,sourceJournalSha256}){
 const failed=Object.entries(source.pcbActions??{}).filter(([key,a])=>key.startsWith('route/')&&a.state==='failed_preserved');
 if(!failed.length&&source.finish?.state==='closed'&&source.pcbLayoutBaseline&&(!source.pcbCopperBaseline||['closed_unrouted_layout','closed_routed_layout'].includes(source.continuation?.selectedStage?.kind))&&!source.pcbFileRouteBaseline&&!source.pcbRepairBaseline)
  return closedLayoutStage(source,{sourcePath,sourceSha256,sourceJournalSha256});
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
