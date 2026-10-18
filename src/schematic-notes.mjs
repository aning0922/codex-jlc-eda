import {noteChangesSchema,notesPhases} from './schematic-notes-input.mjs';
export {noteChangesSchema,notesPhases} from './schematic-notes-input.mjs';
import {readFile,writeFile,realpath,lstat} from 'node:fs/promises';
import path from 'node:path';
import {fingerprint,drawingScript} from './drawing.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {archiveSources} from './incremental-source.mjs';
import {preserveArchive} from './eco-preservation.mjs';
import {boundEco,ecoRead,ecoTarget} from './eco.mjs';
import {ensureTaskContext} from './task-session.mjs';
import {losslessView} from './file-checkpoint.mjs';
import {persist} from './workflow.mjs';
import {scripts} from './native-scripts.mjs';
import {pcbScript} from './pcb.mjs';
import {routingScript} from './p3.mjs';
import {auditCopper} from './copper.mjs';
import {digest} from './facts.mjs';
import {withFreshRead} from './resources.mjs';
const fail=(code,status='failed')=>{throw Object.assign(Error(code),{code,status});};
const equal=(a,b)=>fingerprint(a)===fingerprint(b);
const assignment=s=>({components:s.connectivity.netlist.components,netNames:[...s.connectivity.netlist.netNames].sort()});
export function planNotes(input,snapshot,pageUuid,probe){
 const notes=noteChangesSchema.parse(input),doc=archiveSources(snapshot.schematicData).get(pageUuid);
 if(nativeModelRecords(snapshot.schematicData).get(pageUuid)?.docType!=='SCH_PAGE')fail('NOTES_PAGE_REQUIRED');
 // archiveSources exposes DOCHEAD separately; prove the page via public read too.
 if(snapshot.schematicDocument.documentUuid!==pageUuid||snapshot.schematicDocument.kind!=='schematic'||snapshot.schematicDocument.truncated!==false||probe.status!=='ok'||probe.pageUuid!==pageUuid)fail('NOTES_PAGE_REQUIRED');
 const edits=notes.map(n=>{
  const rows=doc?.rows.filter(r=>r.header.id===n.id)??[],apis=probe.texts.filter(t=>t.id===n.id);
  if(rows.length!==1||rows[0].header.type!=='TEXT'||apis.length!==1||apis[0].primitiveType!=='Text')fail('NOTES_FREE_TEXT_REQUIRED');
  const before=rows[0].body,apiBefore=apis[0];
  if(before.parentId!==undefined||before.partId!==undefined||before.value!==n.expectedText||apiBefore.content!==before.value||apiBefore.x!==before.x||apiBefore.y!==-before.y||before.rotation!==0||apiBefore.rotation!==0)fail('NOTES_OLD_TEXT_OR_POSE_MISMATCH');
  const after={...before,value:n.text??before.value};
  if(n.atMm){after.x=Math.round(n.atMm[0]/.254*1e6)/1e6;after.y=-Math.round(n.atMm[1]/.254*1e6)/1e6;}
  if(equal(before,after))fail('NOTES_NO_CHANGE');
  return{type:'TEXT',id:n.id,before,after,apiBefore,apiProperty:{content:after.value,x:after.x,y:-after.y}};
 });
 return{pageUuid,input:notes,edits,baselineSchematic:snapshot.schematic.sha256,baselinePcb:snapshot.design.sha256,qualification:'Only independent page TEXT content and x/y; all styles and all other native records remain exact. atMm converted to schematic 10mil API units, storage Y inverted.'};
}
export function notesPreservation(baseline,after,pageUuid,edits){
 const schematic=preserveArchive(baseline.schematicData,after.schematicData,{mainUuid:pageUuid,edits}),pcb=preserveArchive(baseline.data,after.data),rows=archiveSources(after.schematicData).get(pageUuid)?.rows??[];
 // Text edits are exact, including x/y; do not inherit generic placement rounding.
 for(const e of edits){const n=rows.filter(r=>r.header.type==='TEXT'&&r.header.id===e.id);if(n.length!==1||!equal(n[0].body,e.after))schematic.issues.push({code:'NOTES_EXACT_TEXT_BODY_MISMATCH',id:e.id});}
 schematic.status=schematic.issues.length?'mismatch':'matched';
 const logic=equal(assignment(baseline),assignment(after)),rules=equal(baseline.rules,after.rules),ready=schematic.status==='matched'&&pcb.status==='matched'&&logic&&rules&&after.connectivity.comparison.status==='matched';
 return{status:ready?'matched':'mismatch',schematic,pcb,logicUnchanged:logic,rulesUnchanged:rules,pinNetPad:after.connectivity.comparison};
}
// Fixed official API program. It cannot accept arbitrary JS, primitives or fields.
async function nativeNotes(p){
 const same=async()=>{const prj=await eda.dmt_Project.getCurrentProjectInfo(),d=await eda.dmt_SelectControl.getCurrentDocumentInfo();return prj?.uuid===p.expectedProjectUuid&&d?.parentProjectUuid===p.expectedProjectUuid&&d?.uuid===p.schematicPageUuid&&d?.documentType===1;};
 if(!await same())return{status:'failed',code:'NOTES_NATIVE_TARGET_MISMATCH'};
 const read=t=>({id:t.getState_PrimitiveId(),primitiveType:t.getState_PrimitiveType(),x:t.getState_X(),y:t.getState_Y(),content:t.getState_Content(),rotation:t.getState_Rotation(),textColor:t.getState_TextColor(),fontName:t.getState_FontName(),fontSize:t.getState_FontSize(),bold:t.getState_Bold(),italic:t.getState_Italic(),underLine:t.getState_UnderLine(),alignMode:t.getState_AlignMode()});
 const texts=(await eda.sch_PrimitiveText.getAll()).map(read);
 if(p.operation==='read')return{status:'ok',pageUuid:p.schematicPageUuid,texts};
 if(p.operation==='prepare'){
  const found=texts.filter(t=>t.id===p.noteId);if(found.length!==1||found[0].primitiveType!=='Text')return{status:'failed',code:'NOTES_FREE_TEXT_REQUIRED'};
  const clear=await eda.sch_SelectControl.clearSelected();if(clear!==true)return{status:'unknown',code:'NOTES_SELECTION_UNCONFIRMED'};
  await eda.sch_SelectControl.doSelectPrimitives([p.noteId]);const selected=await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();if(selected.length!==1||selected[0]!==p.noteId)return{status:'unknown',code:'NOTES_SELECTION_UNCONFIRMED'};
  await eda.dmt_EditorControl.zoomToSelectedPrimitives();return{status:'ok',selected,text:found[0],nativeDesignMutationRequested:false};
 }
 if(p.operation!=='edit')return{status:'failed',code:'NOTES_NATIVE_OPERATION_REQUIRED'};
 const e=p.edit,found=texts.filter(t=>t.id===e.id);
 if(found.length!==1||found[0].primitiveType!=='Text'||JSON.stringify(found[0])!==JSON.stringify(e.apiBefore))return{status:'failed',code:'NOTES_NATIVE_OLD_BODY_CHANGED'};
 if(!await same())return{status:'failed',code:'NOTES_NATIVE_TARGET_MISMATCH'};
 const result=await eda.sch_PrimitiveText.modify(e.id,{content:e.apiProperty.content,x:e.apiProperty.x,y:e.apiProperty.y});
 if(!result||!await same())return{status:'unknown',code:'NOTES_NATIVE_EDIT_UNCONFIRMED'};
 const stable=(await eda.sch_PrimitiveText.getAll()).map(read).filter(t=>t.id===e.id);if(stable.length!==1)return{status:'unknown',code:'NOTES_NATIVE_READBACK_MISSING'};const actual=stable[0],expected={...e.apiBefore,...e.apiProperty};
 return{status:JSON.stringify(actual)===JSON.stringify(expected)?'ok':'unknown',code:JSON.stringify(actual)===JSON.stringify(expected)?undefined:'NOTES_NATIVE_READBACK_MISMATCH',id:e.id,before:e.apiBefore,after:actual};
}
export const notesScript=p=>`(${nativeNotes.toString()})(${JSON.stringify(p)})`;
export const noteStepDone=v=>v?.state==='returned'||v?.state==='verified_by_readback'&&v.result?.code==='NOTES_NATIVE_READBACK_MISMATCH'&&v.recovery?.code==='NOTES_FIRST_TEXT_COMMIT_PROVED'&&v.recovery?.proof?.status==='matched';
export function qualifyFirstNoteCommit(r,current,probe){const s=r.notesECO,e=s.plan?.edits[0],v=e&&s.steps['text/'+e.id];if(!e||Object.keys(s.steps).length!==1||v?.state!=='unknown'||v.result?.code!=='NOTES_NATIVE_READBACK_MISMATCH'||!equal(v.result.before,e.apiBefore)||e.apiBefore.alignMode!==6||!equal(v.result.after,{...e.apiBefore,...e.apiProperty,alignMode:3})||probe.status!=='ok'||probe.pageUuid!==s.plan.pageUuid||probe.texts.length!==s.plan.edits.length)fail('NOTES_FIRST_TEXT_COMMIT_UNPROVEN','unknown');for(const [i,n]of s.plan.edits.entries()){const found=probe.texts.filter(t=>t.id===n.id),want=i===0?{...n.apiBefore,...n.apiProperty}:n.apiBefore;if(found.length!==1||!equal(found[0],want))fail('NOTES_FIRST_TEXT_COMMIT_UNPROVEN','unknown');}const before=notesPreservation(r.baseline,current,s.plan.pageUuid,[]);if(before.status!=='matched')fail('NOTES_FIRST_TEXT_COMMIT_UNPROVEN','unknown');return{edit:e,proof:before};}
export async function notesStage(ctx,key,fn){
 const s=ctx.r.notesECO;if(s.steps[key]){if(!noteStepDone(s.steps[key]))fail('NOTES_ACTION_OUTCOME_UNKNOWN','unknown');return s.steps[key].result;}
 s.steps[key]={state:'pending',at:new Date().toISOString()};await persist(ctx.dir,ctx.r);
 try{const result=await fn();Object.assign(s.steps[key],{state:result.status==='ok'?'returned':'unknown',result});await persist(ctx.dir,ctx.r);if(result.status!=='ok')fail(result.code??'NOTES_ACTION_UNCONFIRMED','unknown');return result;}catch(e){s.steps[key].state='unknown';s.steps[key].error={code:e.code,message:e.message};await persist(ctx.dir,ctx.r);throw e;}
}
export function notesUiFallbackEligible(r){
 const s=r.notesECO,e=s.plan?.edits[0],v=e&&s.steps['text/'+e.id],c=s.firstTextCommit;
 return !!e&&v?.state==='unknown'&&v.result?.code==='NOTES_NATIVE_READBACK_MISMATCH'&&equal(v.result.before,e.apiBefore)&&e.apiBefore.alignMode===6&&equal(v.result.after,{...e.apiBefore,...e.apiProperty,alignMode:3})&&s.steps['commit-first-text']?.state==='returned'&&c?.code==='NOTES_FIRST_TEXT_NOT_PERSISTED'&&notesPreservation(r.baseline,c.sourceRead,s.plan.pageUuid,[]).status==='matched'&&Object.entries(s.steps).every(([k,x])=>k==='text/'+e.id||x.state==='returned');
}
// One explicit recovery of this existing notes work file. No native edit/save is
// replayed. The original open receipt, unknown result and save probe stay intact.
export async function recoverNotesContext(a,p,dir,r){
 const s=r.notesECO,file=path.join(dir,'work.eprj2');
 if(p.phase!=='recover'||p.mode!=='notes'||r.finish||s.contextRecovery||!notesUiFallbackEligible(r)||s.uiAdoption||r.taskOpenAttempt?.state!=='returned'||r.path!==file||await realpath(file)!==file||!(await lstat(file)).isFile()||digest(await readFile(file))!==r.source.sha256)fail('NOTES_CLOSED_RECOVERY_UNPROVEN','unknown');
 const recovery={state:'pending',at:new Date().toISOString(),fileSha256:r.source.sha256,previousSessionId:r.sessionId,previousProjectUuid:r.projectUuid,previousOpenAttempt:structuredClone(r.taskOpenAttempt),originalStepsFingerprint:fingerprint(s.steps)};
 s.contextRecovery=recovery;await persist(dir,r);
 try{
  const context=await ensureTaskContext(a,dir,r,{allowOpen:true});recovery.context=context;
  if(context.status!=='ok'){recovery.state='unknown';await persist(dir,r);return{error:{...context,recovery},dir,r};}
  const q=ecoTarget(r),after=await ecoRead(a,q,r.baseline.physical.stored),proof=notesPreservation(r.baseline,after,q.schematicPageUuid,[]);
  await a.invoke(q.sessionId,scripts.focus({...q,documentUuid:q.schematicPageUuid,kind:'schematic'}));
  const texts=await a.invoke(q.sessionId,notesScript({...q,operation:'read'}));
  const textsMatch=texts.status==='ok'&&texts.pageUuid===s.plan.pageUuid&&texts.texts.length===s.plan.edits.length&&s.plan.edits.every(e=>{const found=texts.texts.filter(t=>t.id===e.id);return found.length===1&&equal(found[0],e.apiBefore);});
  Object.assign(recovery,{proof,texts,fullSnapshot:after,originalStepsRetained:fingerprint(s.steps)===recovery.originalStepsFingerprint});
  if(proof.status!=='matched'||!textsMatch||!recovery.originalStepsRetained)fail('NOTES_RECOVERED_DESIGN_MISMATCH','unknown');
  recovery.state='verified';r.bindingStatus='verified';await persist(dir,r);return{dir,r,p:q};
 }catch(e){recovery.state='unknown';recovery.error={code:e.code??e.message,message:e.message};await persist(dir,r);throw e;}
}
export const notesActionsResolved=r=>Object.values(r.notesECO.steps).every(noteStepDone)||r.notesECO.uiAdoption?.status==='matched'&&notesUiFallbackEligible(r);
export async function notesWorkflow(p){
 if(![p.sourcePath,p.sourceCheckpointPath,p.outputDirectory].every(path.isAbsolute))fail('NOTES_ABSOLUTE_PATH_REQUIRED');
 const a=losslessView(this),ctx=await boundEco(a,p);if(ctx.error)return ctx.error;if(ctx.closed)return ctx.result;const r=ctx.r,s=r.notesECO,q=ctx.p;
 if(!s)fail('NOTES_MODE_REQUIRED');if(!notesPhases.includes(p.phase))fail('NOTES_PHASE_UNSUPPORTED');if(r.finish)fail('NOTES_CLOSE_OUTCOME_UNRESOLVED','unknown');
 const snapshot=()=>ecoRead(a,q,r.baseline.physical.stored),focus=kind=>a.invoke(q.sessionId,scripts.focus({...q,kind,documentUuid:kind==='pcb'?q.pcbDocumentUuid:q.schematicPageUuid})),stage=(key,fn)=>notesStage(ctx,key,fn),save=async kind=>{await focus(kind);return stage('save-'+kind,async()=>{const x=await a.invoke(q.sessionId,kind==='pcb'?pcbScript({...q,operation:'save'}):drawingScript({...q,operation:'save'}));return{...x,status:x.nativeSaveResult===true?'ok':'unknown'};});};
 if(p.phase==='read'||p.phase==='recover'){const current=await snapshot();await focus('schematic');return{status:'ok',snapshot:current,texts:await a.invoke(q.sessionId,notesScript({...q,operation:'read'})),unresolved:Object.entries(s.steps).filter(([,v])=>v.state!=='returned'),nativeMutationRequested:false};}
 if(p.phase==='plan'){
  if(!p.noteChanges)fail('NOTES_CHANGES_REQUIRED','needs_input');if(s.plan)return{status:'ok',reused:true,plan:s.plan};
  const current=await snapshot();if(current.design.sha256!==r.baseline.design.sha256||current.schematic.sha256!==r.baseline.schematic.sha256)fail('NOTES_BASELINE_CHANGED');await focus('schematic');const probe=await a.invoke(q.sessionId,notesScript({...q,operation:'read'}));
  s.plan=planNotes(p.noteChanges,current,q.schematicPageUuid,probe);s.inputFingerprint=fingerprint(p.noteChanges);s.state='planned';await persist(ctx.dir,r);return{status:'ok',plan:s.plan,nativeMutationRequested:false};
 }
 if(!s.plan)fail('NOTES_PLAN_REQUIRED');
 if(p.phase==='prepare_notes'){
  if(!p.noteId||!notesUiFallbackEligible(r))fail('NOTES_NATIVE_UI_FALLBACK_UNPROVEN','unknown');
  await focus('schematic');const result=await a.invoke(q.sessionId,notesScript({...q,operation:'prepare',noteId:p.noteId}));s.uiPreparations??={};s.uiPreparations[p.noteId]={at:new Date().toISOString(),result};await persist(ctx.dir,r);return{...result,target:q,planned:s.plan.edits.find(e=>e.id===p.noteId)};
 }
 if(p.phase==='adopt_notes'){
  if(s.uiAdoption)return{status:s.state==='applied'&&notesActionsResolved(r)?'ok':'unknown',code:s.state==='applied'?undefined:'NOTES_ADOPTION_SAVE_UNRESOLVED',reused:true,proof:s.uiAdoption,nativeMutationRequested:false};
  if(!notesUiFallbackEligible(r)||s.plan.edits.some(e=>s.uiPreparations?.[e.id]?.result?.status!=='ok'))fail('NOTES_NATIVE_UI_PREPARATION_REQUIRED','unknown');
  const after=await snapshot(),proof=notesPreservation(r.baseline,after,q.schematicPageUuid,s.plan.edits);await writeFile(path.join(ctx.dir,'notes-ui-adoption-'+Date.now()+'.json'),JSON.stringify({after,proof},null,2));if(proof.status!=='matched')return{status:'unknown',code:'NOTES_NATIVE_UI_NOT_MATCHED',proof};
  s.uiAdoption={...proof,at:new Date().toISOString(),method:'Native property panel; exact frozen text plan and full non-target archives',firstApiOutcomeRetained:true,design:after.design,schematic:after.schematic};await persist(ctx.dir,r);await save('schematic');s.state='applied';await persist(ctx.dir,r);return{status:'ok',proof:s.uiAdoption,verificationRequired:true};
 }
 if(p.phase==='complete'){
  if(s.firstTextCommit)return{...s.firstTextCommit,reused:true,nativeMutationRequested:false};
  const current=await snapshot();await focus('schematic');const probe=await a.invoke(q.sessionId,notesScript({...q,operation:'read'})),qualified=qualifyFirstNoteCommit(r,current,probe);
  const saved=await stage('commit-first-text',async()=>{const x=await a.invoke(q.sessionId,drawingScript({...q,operation:'save'}));return{...x,status:x.nativeSaveResult===true?'ok':'unknown'};});
  const after=await snapshot(),proof=notesPreservation(r.baseline,after,q.schematicPageUuid,[qualified.edit]);s.firstTextCommit={status:proof.status==='matched'?'ok':'unknown',code:proof.status==='matched'?'NOTES_FIRST_TEXT_COMMIT_PROVED':'NOTES_FIRST_TEXT_NOT_PERSISTED',proof,saved,sourceRead:after,mutationReplayed:false};
  if(proof.status==='matched'){const v=s.steps['text/'+qualified.edit.id];v.state='verified_by_readback';v.recovery={priorState:'unknown',code:'NOTES_FIRST_TEXT_COMMIT_PROVED',proof,observedApi:probe.texts.find(t=>t.id===qualified.edit.id)};}
  await persist(ctx.dir,r);return s.firstTextCommit;
 }
 if(p.phase==='schematic'){
  if(Object.values(s.steps).some(v=>!noteStepDone(v)))fail('NOTES_ACTION_OUTCOME_UNKNOWN','unknown');
  const completed=()=>s.plan.edits.filter(e=>noteStepDone(s.steps['text/'+e.id])),current=await snapshot();
  if(notesPreservation(r.baseline,current,q.schematicPageUuid,completed()).status!=='matched')fail('NOTES_FULL_PREWRITE_MISMATCH');await focus('schematic');
  for(const e of s.plan.edits){await stage('text/'+e.id,()=>a.invoke(q.sessionId,notesScript({...q,operation:'edit',edit:e})));if(s.steps['text/'+e.id].state!=='verified_by_readback')await stage('commit/'+e.id,async()=>{const x=await a.invoke(q.sessionId,drawingScript({...q,operation:'save'}));return{...x,status:x.nativeSaveResult===true?'ok':'unknown'};});const archive=await a.invoke(q.sessionId,drawingScript({...q,operation:'archive'}));if(archive.status!=='ok')fail('NOTES_POSTWRITE_CAPTURE_INCOMPLETE','unknown');const proof=notesPreservation(r.baseline,{...current,schematicData:archive.data},q.schematicPageUuid,completed());s.lastTextProof=proof;await persist(ctx.dir,r);if(proof.status!=='matched')fail('NOTES_POSTWRITE_MISMATCH','unknown');}
  await save('schematic');s.state='applied';await persist(ctx.dir,r);return{status:'ok',edits:s.plan.edits,target:q,verificationRequired:true};
 }
 if(s.state!=='applied'||!notesActionsResolved(r))fail('NOTES_COMPLETED_ACTIONS_REQUIRED','unknown');
 if(p.phase==='preview'){const files={};for(const kind of ['schematic','pcb']){await focus(kind);const x=await a.invoke(q.sessionId,kind==='pcb'?pcbScript({...q,operation:'preview'}):drawingScript({...q,operation:'preview',format:'png'}));if(x.status!=='ok')return x;const file=path.join(ctx.dir,'notes-'+kind+'.png');await writeFile(file,Buffer.from(x.data,'base64'));files[kind]=file;}return{status:'ok',files};}
 const verify=async target=>{const after=await ecoRead(a,target,r.baseline.physical.stored),preservation=notesPreservation(r.baseline,after,q.schematicPageUuid,s.plan.edits),graph=auditCopper(after.document,after.physical.native),drc=await a.invoke(target.sessionId,routingScript({...target,operation:'check'}),60000),ready=preservation.status==='matched'&&graph.fullyConnected&&drc.status==='ok'&&drc.strict===true&&drc.errors.length===0&&equal(drc.beforeRules,drc.afterRules);return{status:ready?'ok':'unknown',boardReady:ready,preservation,graph,drc,design:after.design,schematic:after.schematic,apiCount:after.physical.apiCount,physicalCount:after.physical.physicalCount};};
 const verified=await verify(q);s.verification=verified;await persist(ctx.dir,r);await writeFile(path.join(ctx.dir,'notes-verification.json'),JSON.stringify(verified,null,2)+'\n');if(p.phase!=='finish'||verified.status!=='ok')return verified;
 const savedSch=await save('schematic'),savedPcb=await save('pcb'),before=await verify(q),sha=digest(await readFile(r.path));if(before.status!=='ok')return before;
 const disk=await withFreshRead(a,r.path,async f=>{if(f.status!=='ok'||!f.freshDiskContext||!f.inspectionCopy||f.reusedOwnedSession||f.sessionId===q.sessionId||f.sourceSha256!==sha)fail('NOTES_FRESH_CONTEXT_UNCERTAIN');const v=await verify({...q,evidenceDirectory:undefined,sessionId:f.sessionId,expectedProjectUuid:f.project.uuid});return{...v,reopened:f,persistenceVerified:v.status==='ok'&&v.design.sha256===before.design.sha256&&v.schematic.sha256===before.schematic.sha256};}),last=await verify(q);
 const sourceStable=digest(await readFile(r.source.path))===r.source.sha256&&digest(await readFile(r.source.checkpointPath))===r.source.checkpointSha256;
 if(!sourceStable||!disk.persistenceVerified||disk.resourceCleanup.status!=='ok'||last.status!=='ok'||last.design.sha256!==before.design.sha256||last.schematic.sha256!==before.schematic.sha256||digest(await readFile(r.path))!==sha)return{status:'unknown',code:'NOTES_FRESH_DISK_UNVERIFIED',disk,sourceStable,editorWindowDestroyed:false};
 r.finish={state:'verified_before_close',sourceSha256:sha,disk,at:new Date().toISOString()};await persist(ctx.dir,r);const closed=await a.destroyOwnedSession(q.sessionId,{workVerified:true}),result={...last,path:r.path,workDirectory:ctx.dir,savedSch,savedPcb,persistenceVerified:true,fullDesignArchiveCompared:true,disk,closed};Object.assign(r.finish,{state:closed.status==='ok'?'closed':'close_unknown',closed,result});await persist(ctx.dir,r);return result;
}
