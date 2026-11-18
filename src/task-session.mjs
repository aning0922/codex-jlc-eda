import path from 'node:path';
import {realpath} from 'node:fs/promises';
import {persist} from './workflow.mjs';
import {resourceIdentityScript,resourceAnchorPath} from './resources.mjs';

const problem=(code,extra={})=>({status:'unknown',code,...extra});
const canonical=p=>realpath(p).catch(()=>null);
export function checkRenderMode(r, requested) {
 if(requested && r.renderMode && requested!==r.renderMode)
  throw Object.assign(Error('The render mode is bound to the working copy.'),{code:'WORK_RENDER_MODE_CONFLICT',status:'needs_input'});
}
export const interactiveRequired=(r,action)=>({status:'needs_ui',code:'VISIBLE_WORK_SESSION_REQUIRED',path:r.path,action,
 nativeMutationRequested:false,nextAction:'Use the native editor on an explicitly visible working copy for this step.'});
async function exactContext(a,s,file){
 if(s.path&&await canonical(s.path)!==file)return null;
 let identity;try{identity=await a.invoke(s.sessionId,resourceIdentityScript);}catch{return null;}
 return identity.status==='ok'&&await canonical(resourceAnchorPath(identity.anchor)??'')===file?identity:null;
}
// A recorded sid is evidence of a past binding, never proof that it is alive now.
// An unknown open is discovered only; its native command is never replayed.
export async function ensureTaskContext(a,dir,r,{allowOpen=true,renderMode:requested}={}){
 checkRenderMode(r,requested);
 const file=await canonical(r.path);
 if(!file||file!==path.join(await realpath(dir),'work.eprj2'))return problem('TASK_WORK_PATH_MISMATCH',{path:r.path});
 const listed=await a.jlc_eda_sessions();
 if(!Array.isArray(listed.sessions)||listed.status&&listed.status!=='ok')return problem('TASK_SESSION_DISCOVERY_INCOMPLETE',{sessions:listed});
 const alive=listed.sessions.filter(s=>s.status==='alive'),recorded=alive.find(s=>s.sessionId===r.sessionId);
 let session=recorded,identity,reused=!!recorded,openedThisCall=false;
 const attempt=r.taskOpenAttempt, renderMode=requested??r.renderMode??(attempt?.response?.headless===false?'visible':'headless');
 const hidden=renderMode==='headless';
 if(session){
  if((r.renderMode||requested) && session.headless!==hidden)return problem('TASK_RENDER_MODE_UNCONFIRMED',{path:file,sessionId:session.sessionId});
  identity=await exactContext(a,session,file);
  if(!identity)return problem('TASK_ACTIVE_PATH_UNCONFIRMED',{sessionId:session.sessionId,path:file});
 }else{
  const matches=[];
  for(const candidate of alive){
   if(!candidate.path||await canonical(candidate.path)!==file)continue;
   if(!attempt?.beforeSessionIds||attempt.beforeSessionIds.includes(candidate.sessionId)||candidate.origin!=='cli'||candidate.headless!==hidden)
    return problem('TASK_PATH_ALREADY_IN_USE',{path:file,sessionId:candidate.sessionId});
   const i=await exactContext(a,candidate,file);
   if(!i)return problem('TASK_ACTIVE_PATH_UNCONFIRMED',{path:file,sessionId:candidate.sessionId});
   matches.push({s:candidate,i});
  }
  if(matches.length>1)return problem('TASK_MULTIPLE_EXACT_CONTEXTS',{path:file,matches:matches.map(x=>x.s.sessionId)});
  if(matches.length===1){session=matches[0].s;identity=matches[0].i;reused=true;attempt.state='discovered';}
  else{
   if(attempt&&['pending','unknown'].includes(attempt.state))return problem('TASK_OPEN_OUTCOME_UNKNOWN',{path:file,openAttempt:attempt,mutationReplayed:false});
   if(!allowOpen)return problem('TASK_CONTEXT_CONFIRMED_CLOSED',{path:file,previousSessionId:r.sessionId??null});
   if(!hidden)await a.ensureWorkWindowBudget();
   const previous={sessionId:r.sessionId??null,projectUuid:r.projectUuid??null,openPathConfirmed:r.openPathConfirmed??false,bindingStatus:r.bindingStatus??null};
   r.renderMode=renderMode;r.bindingStatus='verification_pending';r.taskOpenAttempt={state:'pending',beforeSessionIds:alive.map(x=>x.sessionId),previous,path:file,startedAt:new Date().toISOString()};await persist(dir,r);
   let opened;try{opened=await a.call(['open','--path',file,'--headless',String(hidden)],35000);}catch(e){r.taskOpenAttempt.state='unknown';r.taskOpenAttempt.error={code:e.code,message:e.message};await persist(dir,r);return problem(e.code??'TASK_OPEN_OUTCOME_UNKNOWN',{path:file,openAttempt:r.taskOpenAttempt});}
   const v=opened.value;r.taskOpenAttempt.response=v;
   if(!v?.sessionId||v.path!==file||v.headless!==hidden||alive.some(x=>x.sessionId===v.sessionId)){r.taskOpenAttempt.state='unknown';await persist(dir,r);return problem('TASK_OPEN_IDENTITY_UNCONFIRMED',{path:file,response:v});}
   r.taskOpenAttempt.state='returned';openedThisCall=true;session={...v,status:'alive'};r.sessionId=v.sessionId;r.openPathConfirmed=true;await persist(dir,r);
   const deadline=Date.now()+15000;
   do{identity=await exactContext(a,session,file);if(identity)break;await new Promise(resolve=>setTimeout(resolve,300));}while(Date.now()<deadline);
   if(!identity)return problem('TASK_OPEN_PATH_UNCONFIRMED',{path:file,sessionId:session.sessionId});
  }
 }
 if(typeof session.headless==='boolean')r.renderMode=session.headless?'headless':'visible';
 const oldBinding=openedThisCall?{...r.taskOpenAttempt.previous,path:r.path}:{sessionId:r.sessionId??null,projectUuid:r.projectUuid??null,path:r.path};
 if(reused&&!allowOpen&&r.sessionId&&r.sessionId!==session.sessionId)return problem('TASK_RECORDED_SESSION_CHANGED',{sessionId:session.sessionId});
 const mustMatchProject=reused&&!!r.projectUuid;

 let project;
 for(let i=0;i<5;i++){project=await a.jlc_eda_inspect_project({sessionId:session.sessionId,waitForReady:true});if(!['NO_CURRENT_PROJECT','PROJECT_TREE_NOT_READY_OR_EMPTY'].includes(project.code))break;if(i<4)await new Promise(resolve=>setTimeout(resolve,300));}
 if(project.status!=='ok'){await persist(dir,r);return {...project,code:project.code??'TASK_DOCUMENT_NOT_READY',target:{path:file,sessionId:session.sessionId},openedAgain:false};}
 if(mustMatchProject&&r.projectUuid!==project.project.uuid)return problem('TASK_ACTIVE_PROJECT_MISMATCH',{project});
 const expected=[['schematicPageUuid','Schematic Page'],['schematicUuid','Schematic'],['pcbDocumentUuid','PCB']];
 if(expected.some(([key,type])=>r[key]&&project.documents.filter(x=>x.uuid===r[key]&&x.itemType===type).length!==1))return problem('TASK_DOCUMENT_IDENTITY_CHANGED',{project});
 r.sessionId=session.sessionId;r.openPathConfirmed=true;
 await a.registerWorkSession({sessionId:session.sessionId,path:file,workDirectory:dir,recoveredFromSession:oldBinding.sessionId,renderMode:session.headless===true?'headless':'visible'});
 r.bindingHistory??=[];
 if(oldBinding.sessionId!==session.sessionId||oldBinding.projectUuid!==project.project.uuid)r.bindingHistory.push({...oldBinding,reboundAt:new Date().toISOString(),reason:'exact native path and document identity; previous context no longer alive'});
 r.projectUuid=project.project.uuid;r.documents=project.documents;r.bindingStatus=reused&&r.bindingStatus==='verified'?'verified':'verification_pending';await persist(dir,r);
 return {status:'ok',sessionId:session.sessionId,project,reused,identity,path:file,nativeOpenRequested:openedThisCall,reopenedClosedTask:openedThisCall&&!!oldBinding.sessionId,openedAgain:false};
}
