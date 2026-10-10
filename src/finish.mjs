import {z} from 'zod';import {readFile,realpath} from 'node:fs/promises';
import {load,persist,bound} from './workflow.mjs';import {circuitSchema,drawingScript,fingerprint} from './drawing.mjs';
import {pcbScript} from './pcb.mjs';import {scripts} from './native-scripts.mjs';
import {unresolvedActions} from './pcb-validation.mjs';
import {archiveDesignFingerprint,withFreshRead} from './resources.mjs';import {digest} from './facts.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const finishSchemas={jlc_eda_finish_work_project:z.object({sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,workDirectory:z.string().min(1).max(4096),requestId:id,circuit:circuitSchema,schematicUuid:id.optional(),pcbDocumentUuid:id.optional()}).strict().refine(p=>!!p.schematicUuid===!!p.pcbDocumentUuid,'Both PCB and schematic root are required for PCB work.')};
const unresolved=r=>unresolvedActions(r).length>0;
export async function archive(a,p){
 const schFocus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'}));if(schFocus.status!=='ok')throw Object.assign(new Error('Cannot focus saved task schematic'),schFocus);
 const sch=await a.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));if(sch.status!=='ok')throw Object.assign(new Error('Cannot read full task archive'),sch);
 const result={schematic:archiveDesignFingerprint(sch.data)};
 if(p.pcbDocumentUuid){const pcbFocus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));if(pcbFocus.status!=='ok')throw Object.assign(new Error('Cannot focus task PCB'),pcbFocus);
  const pcb=await a.invoke(p.sessionId,pcbScript({...p,operation:'archive'}));if(pcb.status!=='ok')throw Object.assign(new Error('Cannot read full PCB archive'),pcb);result.pcb=archiveDesignFingerprint(pcb.data);
 }
 return result;
}
export const finishWorkflow={async jlc_eda_finish_work_project(p){
 // Check unresolved task actions before focusing anything (an import review may be open).
 const dir=await realpath(p.workDirectory);let initial=await load(dir);
 if(initial.kind!=='task_work_project'||initial.sessionId!==p.sessionId||initial.projectUuid!==p.expectedProjectUuid||initial.schematicPageUuid!==p.schematicPageUuid)return {status:'failed',code:'WORK_TARGET_MISMATCH'};
 if(unresolved(initial))return {status:'unknown',code:'WORK_ACTION_UNRESOLVED',editorWindowDestroyed:false,nextAction:'Read back the pending action without replay. This work window is retained.'};
 if(fingerprint(initial.circuit)!==fingerprint(p.circuit))return {status:'failed',code:'FINISH_CIRCUIT_CONFLICT',editorWindowDestroyed:false};
 if(initial.pcbDocumentUuid&&(initial.pcbDocumentUuid!==p.pcbDocumentUuid||initial.schematicUuid!==p.schematicUuid))return {status:'needs_input',code:'FINISH_ASSOCIATED_PCB_REQUIRED',editorWindowDestroyed:false,nextAction:'Provide the task recorded schematicUuid and pcbDocumentUuid, including an unsynchronized empty PCB.'};
 const ruleCleanup=[];
 for(const [key,action] of Object.entries(initial.pcbActions??{}))if(key.startsWith('rules/')&&action.autoRecovery?.ownedProfiles?.length&&!action.autoRecovery.cleanupVerified){
  if(!action.plan.input)return {status:'unknown',code:'WORK_RULE_CLEANUP_INPUT_UNCONFIRMED',editorWindowDestroyed:false};
  const cleanup=await this.jlc_eda_configure_pcb_rules({...p,requestId:key.slice(6),rules:action.plan.input,phase:'cleanup'});ruleCleanup.push(cleanup);
  if(cleanup.status!=='ok')return {status:'unknown',code:'WORK_RULE_CLEANUP_UNVERIFIED',ruleCleanup,editorWindowDestroyed:false};
 }
 if(ruleCleanup.length)initial=await load(dir);
 const ctx=await bound(this,p);
 const verifyPcb=!!initial.pcbSyncBaseline;
 const verify=target=>initial.pcbLayoutBaseline?this.verifyP3Checkpoint(target,initial):verifyPcb?this.jlc_eda_verify_pcb(target):this.jlc_eda_verify_schematic({...target,pcbDocumentUuid:undefined});
 // Re-adopt only a genuine durable plugin record after service restart.
 if(!this.resources.entries.has(p.sessionId)){
  const stored=(await this.resources.all()).find(r=>r.sessionId===p.sessionId&&r.path===initial.path&&r.kind==='work');
  if(!stored)return {status:'unknown',code:'WORK_RESOURCE_OWNERSHIP_UNCONFIRMED',editorWindowDestroyed:false};
  await this.registerWorkSession({sessionId:p.sessionId,path:initial.path,workDirectory:dir,recoveredFromOwner:stored.ownerId});
 }
 const saved=await this.jlc_eda_save_work_project(p);
 const live=await verify(p);
 if(live.status!=='ok'||live.comparison?.status!=='matched')return {status:'unknown',code:'WORK_FINISH_LIVE_UNVERIFIED',saved,live,editorWindowDestroyed:false};
 const before=await archive(this,p),sourceSha256=digest(await readFile(initial.path));
 const disk=await withFreshRead(this,initial.path,async fresh=>{
  if(fresh.status!=='ok'||!fresh.freshDiskContext||fresh.reusedOwnedSession||!fresh.inspectionCopy||fresh.sessionId===p.sessionId||fresh.path===initial.path||fresh.sourcePath!==initial.path||fresh.sourceSha256!==sourceSha256||!id.safeParse(fresh.project?.uuid).success)return {status:'unknown',code:'FINISH_FRESH_CONTEXT_UNCERTAIN',persistenceVerified:false,reopened:fresh};
  const target={...p,sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid};
  const verified=await verify(target);
  const design=await archive(this,target);
  return {...verified,design,reopened:fresh,persistenceVerified:verified.status==='ok'&&verified.comparison?.status==='matched'&&fingerprint(before)===fingerprint(design)};
 });
 const after=await archive(this,p);
 const sourceUnchanged=sourceSha256===digest(await readFile(initial.path));
 if(!disk.persistenceVerified||disk.resourceCleanup.status!=='ok'||fingerprint(before)!==fingerprint(after)||!sourceUnchanged)return {status:'unknown',code:'WORK_FINISH_DISK_OR_FULL_DESIGN_UNVERIFIED',saved,live,disk,before,after,sourceUnchanged,editorWindowDestroyed:false};
 ctx.r.finish={state:'verified_before_close',requestId:p.requestId,sourceSha256,design:before,disk,at:new Date().toISOString()};await persist(dir,ctx.r);
 const closed=await this.destroyOwnedSession(p.sessionId,{workVerified:true});ctx.r.finish={...ctx.r.finish,state:closed.status==='ok'?'closed':'close_unknown',closed};await persist(dir,ctx.r);
 return {...closed,saved,disk,ruleCleanup,persistenceVerified:true,fullDesignArchiveCompared:true,designReady:initial.pcbLayoutBaseline?live.copper?.fullyConnected===true&&live.drc?.status==='ok'&&live.drc.errors.length===0&&live.rulesMatched===true&&live.layout?.status==='matched':null,path:initial.path,workDirectory:dir,executionRecord:dir+'/work-project.json'};
}};
