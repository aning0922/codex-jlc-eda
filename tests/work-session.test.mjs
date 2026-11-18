import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {ensureTaskContext} from '../src/task-session.mjs';
import {withWorkLock} from '../src/work-lock.mjs';
import {closedWorkResult,load,persist} from '../src/workflow.mjs';
import {digest,matchesSchematicScope} from '../src/facts.mjs';
import {passiveWorkflow} from '../src/passive-workflow.mjs';

async function setup(t){
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'a11-test-'))),file=path.join(dir,'work.eprj2');
 t.after(()=>rm(dir,{recursive:true,force:true}));
 await writeFile(file,'input');
 const r={kind:'task_work_project',path:file,renderMode:'headless'};
 const session={sessionId:'owned',headless:true,path:file,status:'alive',origin:'cli'},seen=[];
 const project={status:'ok',project:{uuid:'project'},documents:[{uuid:'page',itemType:'Schematic Page'}]};
 const a={jlc_eda_sessions:async()=>({status:'ok',sessions:[]}),call:async args=>{seen.push(args);return {value:session};},
  invoke:async sid=>{assert.equal(sid,session.sessionId);return {status:'ok',anchor:'#prjPath='+encodeURIComponent(file)};},
  jlc_eda_inspect_project:async()=>project,registerWorkSession:async()=>{}};
 return {dir,file,r,session,seen,a};
}

test('new hidden request records intent first, then a fresh host reuses exactly that session',async t=>{
 const {dir,file,r,a,seen,session}=await setup(t);
 const call=a.call;a.call=async args=>{assert.equal((await load(dir)).taskOpenAttempt.state,'pending');return call(args);};
 assert.equal((await ensureTaskContext(a,dir,r)).status,'ok');
 assert.deepEqual(seen,[['open','--path',file,'--headless','true']]);
 a.jlc_eda_sessions=async()=>({sessions:[session]});
 const resumed=await ensureTaskContext(a,dir,await load(dir),{allowOpen:false});
 assert.equal(resumed.reused,true);assert.equal(resumed.sessionId,'owned');assert.equal(seen.length,1);
});
test('lost open response recovers only a matching new hidden CLI session and never repeats open',async t=>{
 const {dir,file,r,a,session}=await setup(t);let opens=0;
 a.call=async()=>{opens++;throw Object.assign(Error('timeout'),{code:'CLI_TIMEOUT'});};
 assert.equal((await ensureTaskContext(a,dir,r)).code,'CLI_TIMEOUT');
 assert.equal((await ensureTaskContext(a,dir,r)).code,'TASK_OPEN_OUTCOME_UNKNOWN');
 for(const foreign of [{...session,origin:'user'},{...session,headless:false}]){
  a.jlc_eda_sessions=async()=>({sessions:[foreign]});
  assert.equal((await ensureTaskContext(a,dir,r)).code,'TASK_PATH_ALREADY_IN_USE');
 }
 a.jlc_eda_sessions=async()=>({sessions:[session]});
 assert.equal((await ensureTaskContext(a,dir,r)).path,file);assert.equal(opens,1);
});
test('changed current project on recorded session cannot rebind the journal',async t=>{
 const {dir,r,a,session}=await setup(t);Object.assign(r,{sessionId:session.sessionId,projectUuid:'prior',bindingStatus:'verified'});await persist(dir,r);
 a.jlc_eda_sessions=async()=>({sessions:[session]});
 const before=await readFile(path.join(dir,'work-project.json'));
 assert.equal((await ensureTaskContext(a,dir,r)).code,'TASK_ACTIVE_PROJECT_MISMATCH');
 assert.deepEqual(await readFile(path.join(dir,'work-project.json')),before);
});
test('overlapping public operations on the same canonical task never reach the second writer',async t=>{
 const {dir}=await setup(t);let started,release,writes=0;
 const ready=new Promise(resolve=>{started=resolve;}),gate=new Promise(resolve=>{release=resolve;});
 const first=withWorkLock(dir,async()=>{writes++;started();await gate;});
 await ready;try{
  const result=await withWorkLock(path.join(dir,'.'),()=>++writes);
  assert.equal(result.code,'WORK_OPERATION_IN_PROGRESS');assert.equal(writes,1);
 }finally{release();await first;}
 assert.equal(await withWorkLock(dir,()=>++writes),2);
});
test('a closed task requires disk and close evidence and a matching file on every reuse',async t=>{
 const {dir,r,file}=await setup(t);r.finish={sourceSha256:digest(await readFile(file)),disk:{persistenceVerified:true,resourceCleanup:{status:'ok'}},closed:{sessionNoLongerAlive:true}};
 assert.equal((await closedWorkResult(dir,r)).completedFileVerified,true);
 await writeFile(file,'changed');assert.equal((await closedWorkResult(dir,r)).code,'CLOSED_WORK_FILE_OR_PROOF_CHANGED');
});
test('background A9 C1 replacement returns the original picker handoff before selecting or changing a component',async t=>{
 const {dir,r,a,session}=await setup(t),src=path.join(dir,'source.eprj2'),cp=path.join(dir,'source.json');
 await writeFile(src,'source');await writeFile(cp,'journal');
 Object.assign(r,{kind:'schematic_pcb_eco_work_project',requestId:'a9',sessionId:'owned',projectUuid:'project',schematicPageUuid:'page',pcbDocumentUuid:'pcb',
  baseline:{},source:{path:src,sha256:digest(await readFile(src)),checkpointPath:cp,checkpointSha256:digest(await readFile(cp))},
  passiveECO:{plan:{targets:[{action:'modify',input:{designator:'C1'},model:{part:{supplierId:'C14663'}}}]}}});
 await persist(dir,r);a.jlc_eda_sessions=async()=>({sessions:[session]});
 a.jlc_eda_inspect_project=async()=>({status:'ok',project:{uuid:'project'},documents:[{uuid:'pcb',itemType:'PCB'},{uuid:'page',itemType:'Schematic Page'}]});
 a.invokeLossless=async(sid,code)=>{assert.ok(code.includes('getUrlAnchor'));return a.invoke(sid);};
 const out=await passiveWorkflow.call(a,{sourcePath:src,sourceCheckpointPath:cp,outputDirectory:dir,requestId:'a9',mode:'passives',phase:'prepare_replace',targetDesignator:'C1'});
 assert.equal(out.status,'needs_ui');assert.equal(out.action,'native_device_picker');assert.equal(out.targetSupplierId,'C14663');assert.equal(out.nativeMutationRequested,false);
});

test('board-scoped exports require the complete selected schematic component identities',()=>{
 const parts=[{uniqueId:'part-a',designator:'U7'},{uniqueId:'part-b',designator:'U8'}];
 const netlist={components:parts,issues:[]},page={truncated:false,components:parts};
 assert.equal(matchesSchematicScope(netlist,[page]),true);
 for(const other of [[{...page,truncated:true}],[{...page,components:[parts[0]]}],[{...page,components:[parts[0],{...parts[1],designator:'U9'}]}],[]])
  assert.equal(matchesSchematicScope(netlist,other),false);
 assert.equal(matchesSchematicScope({components:[],issues:[]},[{truncated:false,components:[]}]),false);
});

test('explicit headless resume never invokes a legacy visible session',async t=>{
 const {dir,r,a,session}=await setup(t);delete r.renderMode;r.sessionId=session.sessionId;
 a.jlc_eda_sessions=async()=>({sessions:[{...session,headless:false}]});
 a.invoke=()=>assert.fail('Visible session accessed');
 assert.equal((await ensureTaskContext(a,dir,r,{renderMode:'headless'})).code,'TASK_RENDER_MODE_UNCONFIRMED');
});
