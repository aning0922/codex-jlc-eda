import {realpath} from 'node:fs/promises';
import {persist} from './workflow.mjs';
import {resourceIdentityScript,resourceAnchorPath} from './resources.mjs';

const problem=(code,extra={})=>({status:'unknown',code,...extra});
const canonical=p=>realpath(p).catch(()=>null);
async function exactContext(a,s,file){
 if(s.path&&await canonical(s.path)!==file)return null;
 let identity;try{identity=await a.invoke(s.sessionId,resourceIdentityScript);}catch{return null;}
 return identity.status==='ok'&&await canonical(resourceAnchorPath(identity.anchor)??'')===file?identity:null;
}
// A recorded sid is evidence of a past binding, never proof that it is alive now.
// An unknown open is discovered only; its native command is never replayed.
export async function ensureTaskContext(a,dir,r,{allowOpen=true}={}){
 const file=await canonical(r.path),listed=await a.jlc_eda_sessions();
 if(!file||!Array.isArray(listed.sessions)||listed.status&&listed.status!=='ok')return problem('TASK_SESSION_DISCOVERY_INCOMPLETE',{sessions:listed});
 const alive=listed.sessions.filter(s=>s.status==='alive'),recorded=alive.find(s=>s.sessionId===r.sessionId);
 let session=recorded,identity,reused=!!recorded,openedThisCall=false;
 if(session){identity=await exactContext(a,session,file);if(!identity)return problem('TASK_ACTIVE_PATH_UNCONFIRMED',{sessionId:session.sessionId,path:file});}
 else{
  const matches=[];
  for(const s of alive.filter(s=>s.headless!==true).slice(0,8)){const i=await exactContext(a,s,file);if(i)matches.push({s,i});}
  if(matches.length>1)return problem('TASK_MULTIPLE_EXACT_CONTEXTS',{path:file,matches:matches.map(x=>x.s.sessionId)});
  if(matches.length===1){session=matches[0].s;identity=matches[0].i;reused=true;}
  else{
   if(r.taskOpenAttempt&&['pending','unknown'].includes(r.taskOpenAttempt.state))return problem('TASK_OPEN_OUTCOME_UNKNOWN',{path:file,openAttempt:r.taskOpenAttempt,mutationReplayed:false});
   if(!allowOpen)return problem('TASK_CONTEXT_CONFIRMED_CLOSED',{path:file,previousSessionId:r.sessionId??null});
   await a.ensureWorkWindowBudget();
   const previous={sessionId:r.sessionId??null,projectUuid:r.projectUuid??null,openPathConfirmed:r.openPathConfirmed??false,bindingStatus:r.bindingStatus??null};
   r.bindingStatus='verification_pending';r.taskOpenAttempt={state:'pending',beforeSessionIds:alive.map(x=>x.sessionId),previous,path:file,startedAt:new Date().toISOString()};await persist(dir,r);
   let opened;try{opened=await a.call(['open','--path',file],35000);}catch(e){r.taskOpenAttempt.state='unknown';r.taskOpenAttempt.error={code:e.code,message:e.message};await persist(dir,r);return problem(e.code??'TASK_OPEN_OUTCOME_UNKNOWN',{path:file,openAttempt:r.taskOpenAttempt});}
   r.taskOpenAttempt.state='returned';r.taskOpenAttempt.response=opened.value;
   const v=opened.value;if(!v?.sessionId||v.path!==file||alive.some(x=>x.sessionId===v.sessionId)){r.taskOpenAttempt.state='unknown';await persist(dir,r);return problem('TASK_OPEN_IDENTITY_UNCONFIRMED',{path:file,response:v});}
   openedThisCall=true;session={sessionId:v.sessionId,path:v.path,headless:false,status:'alive'};r.sessionId=v.sessionId;r.openPathConfirmed=true;await persist(dir,r);
   identity=await exactContext(a,session,file);if(!identity)return problem('TASK_OPEN_PATH_UNCONFIRMED',{path:file,sessionId:session.sessionId});
  }
 }
 const oldBinding=openedThisCall?{...r.taskOpenAttempt.previous,path:r.path}:{sessionId:r.sessionId??null,projectUuid:r.projectUuid??null,path:r.path};
 const mustMatchProject=reused&&r.kind==='task_work_project'&&!!r.projectUuid&&(r.bindingStatus==='verified'||r.taskOpenAttempt?.response?.sessionId!==session.sessionId);
 r.sessionId=session.sessionId;r.openPathConfirmed=true;
 r.bindingStatus='verification_pending';await persist(dir,r);
 await a.registerWorkSession({sessionId:session.sessionId,path:file,workDirectory:dir,recoveredFromSession:oldBinding.sessionId,renderMode:'visible'});
 let project;
 for(let i=0;i<5;i++){project=await a.jlc_eda_inspect_project({sessionId:session.sessionId});if(!['NO_CURRENT_PROJECT','PROJECT_TREE_NOT_READY_OR_EMPTY'].includes(project.code))break;if(i<4)await new Promise(resolve=>setTimeout(resolve,300));}
 if(project.status!=='ok'){await persist(dir,r);return {...project,code:project.code??'TASK_DOCUMENT_NOT_READY',target:{path:file,sessionId:session.sessionId},openedAgain:false};}
 if(mustMatchProject&&r.projectUuid!==project.project.uuid)return problem('TASK_ACTIVE_PROJECT_MISMATCH',{project});
 const expected=[['schematicPageUuid','Schematic Page'],['schematicUuid','Schematic'],['pcbDocumentUuid','PCB']];
 if(expected.some(([key,type])=>r[key]&&project.documents.filter(x=>x.uuid===r[key]&&x.itemType===type).length!==1))return problem('TASK_DOCUMENT_IDENTITY_CHANGED',{project});
 r.bindingHistory??=[];
 if(oldBinding.sessionId!==session.sessionId||oldBinding.projectUuid!==project.project.uuid)r.bindingHistory.push({...oldBinding,reboundAt:new Date().toISOString(),reason:'exact native path and document identity; previous context no longer alive'});
 r.projectUuid=project.project.uuid;r.documents=project.documents;r.bindingStatus='verification_pending';await persist(dir,r);
 return {status:'ok',sessionId:session.sessionId,project,reused,identity,path:file,nativeOpenRequested:openedThisCall,reopenedClosedTask:openedThisCall&&!!oldBinding.sessionId,openedAgain:false};
}
