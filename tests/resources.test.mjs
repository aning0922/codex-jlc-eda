import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,realpath} from 'node:fs/promises';import path from 'node:path';import os from 'node:os';
import {zipSync,strToU8} from 'fflate';
import {JlcEdaAdapter,runCommand} from '../src/adapter.mjs';import {withFreshRead,archiveDesignFingerprint,resourceAnchorPath} from '../src/resources.mjs';
import {scripts} from '../src/native-scripts.mjs';import {circuitSchema} from '../src/drawing.mjs';import {connectivityScript} from '../src/reading.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
test('composed document still validates target before any inventory and requires one invoke',async()=>{
 const a=new JlcEdaAdapter();let calls=0;a.invoke=async(s,code)=>{calls++;return new AsyncFunction('eda','return await '+code)({dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'actual'})}});};
 const r=await a.dispatch('jlc_eda_read_document',{sessionId:'s',expectedProjectUuid:'wrong',documentUuid:'d',kind:'pcb'});assert.equal(r.code,'TARGET_MISMATCH');assert.equal(calls,1);
});
test('composed connectivity rejects wrong project without activating anything',async()=>{
 const r=await new AsyncFunction('eda','return await '+connectivityScript({expectedProjectUuid:'wrong',schematicPageUuid:'page'}))({dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'actual'})}});assert.equal(r.code,'TARGET_MISMATCH');
});
test('fresh readers are actually destroyed after success, exception and uncertain verification',async()=>{
 for(const mode of ['success','throw','unknown']){
  let closed=0;const a={ownedSessions:new Set(['fresh']),openInspectionProject:async()=>({status:'ok',sessionId:'fresh',freshDiskContext:true,inspectionCopy:true,reusedOwnedSession:false}),destroyOwnedSession:async sid=>{assert.equal(sid,'fresh');closed++;return {status:'ok',editorWindowDestroyed:true};}};
  const result=await withFreshRead(a,'disk',async()=>{if(mode==='throw')throw Object.assign(new Error('read timeout'),{code:'CLI_TIMEOUT',status:'unknown'});return {status:mode==='success'?'ok':'unknown',persistenceVerified:mode==='success'};});
  assert.equal(closed,1);assert.equal(result.resourceCleanup.editorWindowDestroyed,true);if(mode!=='success')assert.notEqual(result.persistenceVerified,true);
 }
});
test('a rejected reused context is retained; cleanup failure stays explicit and never erases read evidence',async()=>{
 let closed=0;const a={ownedSessions:new Set(['cached']),openInspectionProject:async()=>({status:'ok',sessionId:'cached',freshDiskContext:false,inspectionCopy:true,reusedOwnedSession:true}),destroyOwnedSession:async()=>{closed++;throw new Error('offline');}};
 assert.equal((await withFreshRead(a,'disk',async()=>({status:'unknown',persistenceVerified:false}))).persistenceVerified,false);assert.equal(closed,0);
 a.openInspectionProject=async()=>({status:'ok',sessionId:'cached',freshDiskContext:true,inspectionCopy:true,reusedOwnedSession:false});const r=await withFreshRead(a,'disk',async()=>({status:'ok',persistenceVerified:true,comparison:{status:'matched'}}));assert.equal(r.comparison.status,'matched');assert.equal(r.cleanupRequired,true);assert.equal(r.resourceCleanup.status,'unknown');
});
test('owned inspection close requests native destroy, removes cache and confirms not alive',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'p2cr1-'));try{
  const calls=[],a=new JlcEdaAdapter({inspectionRoot:root,executable:'/fake',runner:async(e,args)=>{calls.push(args);return {value:args[0]==='session'&&args[1]==='list'?[]:{status:'closed',headless:true}};}});
  a.ownedSessions.add('read');await a.resources.register({sessionId:'read',kind:'inspection',path:'copy',renderMode:'headless'});a.openedPaths.set('source',{sessionId:'read'});
  const r=await a.dispatch('jlc_eda_close_session',{sessionId:'read'});assert.equal(r.editorWindowDestroyed,true);assert.ok(calls[0].includes('--destroy'));assert.equal(a.openedPaths.size,0);assert.equal(a.ownedSessions.size,0);assert.equal((await a.resources.all()).find(x=>x.sessionId==='read').state,'destroyed');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('one visible work budget uses durable live task records; unrelated windows are never closed',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'p2cr1-budget-'));try{
  const a=new JlcEdaAdapter({inspectionRoot:root});await a.registerWorkSession({sessionId:'work',path:'task'});a.jlc_eda_sessions=async()=>({sessions:[{sessionId:'work',status:'alive'},{sessionId:'foreign',status:'alive'}]});
  await assert.rejects(a.ensureWorkWindowBudget(),e=>e.code==='VISIBLE_WORK_WINDOW_LIMIT');await a.ensureWorkWindowBudget({exceptSessionId:'work'});
  assert.equal((await a.dispatch('jlc_eda_close_session',{sessionId:'work'})).code,'WORK_FINISH_REQUIRED');assert.equal((await a.dispatch('jlc_eda_close_session',{sessionId:'foreign'})).code,'SESSION_NOT_OWNED');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('service shutdown closes only inspections and retains active/unknown writing work',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'p2cr1-dispose-'));try{
  const a=new JlcEdaAdapter({inspectionRoot:root});for(const [sessionId,kind] of [['read','inspection'],['work','work']]){a.ownedSessions.add(sessionId);await a.resources.register({sessionId,kind,path:'copy'});}
  const closed=[];a.destroyOwnedSession=async s=>{closed.push(s);return {status:'ok'};};const r=await a.dispose();assert.deepEqual(closed,['read']);assert.equal(r.retained[0].sessionId,'work');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('timed-out opening recovers only exact new native path; ambiguous or pre-existing contexts are retained',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'p2cr1-open-'));try{
  const a=new JlcEdaAdapter({inspectionRoot:root});await a.resources.register({sessionId:'opening-x',kind:'inspection',path:'/copy/任务.eprj2',beforeSessionIds:['old']});await a.resources.update('opening-x',{state:'opening'});
  a.jlc_eda_sessions=async()=>({sessions:[{sessionId:'old',status:'alive'},{sessionId:'new',status:'alive'},{sessionId:'other',status:'alive'}]});a.invoke=async sid=>({status:'ok',anchor:'#prjPath='+encodeURIComponent(encodeURIComponent(sid==='new'?'/copy/任务.eprj2':'/different/project'))});
  const closed=[];a.destroyOwnedSession=async sid=>{closed.push(sid);return {status:'ok'};};assert.equal((await a.recoverInspectionOpening('opening-x')).status,'ok');assert.deepEqual(closed,['new']);
  assert.equal(resourceAnchorPath('#prjPath=%252Fcopy%252Ffile.eprj2'),'/copy/file.eprj2');
  assert.equal(resourceAnchorPath('id=project,prjPath=%252Fcopy%252Ffile.eprj2,tab=page'),'/copy/file.eprj2');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('CLI exit settles even when a descendant retains stdout; native timeout still remains unknown',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'p2cr1-pipes-'));let pid;
 try{const file=dir+'/fake.mjs';await writeFile(file,"import {spawn} from 'node:child_process';const p=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:['ignore',1,2],detached:true});p.unref();console.log(JSON.stringify({ok:true,value:{pid:p.pid}}));process.exit(0);");
  const started=Date.now(),r=await runCommand(process.execPath,[file],{timeoutMs:1500});pid=r.value.pid;assert.ok(Date.now()-started<1300);
 }finally{if(pid)try{process.kill(pid,'SIGTERM');}catch{}await rm(dir,{recursive:true,force:true});}
});
function archive(note,time=1){const records=[['DOCHEAD',{uuid:'doc',docType:'SCH_PAGE',updateTime:time}],['TEXT',{content:note,x:5,y:7}]];return Buffer.from(zipSync({'models.epru':strToU8(records.map(([type,b])=>JSON.stringify({type,ticket:time})+'||'+JSON.stringify(b)+'|').join('\n'))})).toString('base64');}
test('full design comparison ignores volatile save headers but detects unsaved notes outside pin/net checks',()=>{
 assert.equal(archiveDesignFingerprint(archive('note',1)).sha256,archiveDesignFingerprint(archive('note',2)).sha256);assert.notEqual(archiveDesignFingerprint(archive('unsaved')).sha256,archiveDesignFingerprint(archive('note')).sha256);
});
test('finish refuses unresolved writes before any focus/save/close action',async()=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'p2cr1-finish-')));try{
  const p={workDirectory:dir,sessionId:'work',expectedProjectUuid:'project',schematicPageUuid:'page',requestId:'finish',circuit:{components:[{ref:'c',designator:'U1',deviceUuid:'device',libraryUuid:'lib',supplierId:'supplier',manufacturerPart:'part',footprintUuid:'fp',pose:{x:0,y:0}}],nets:[{name:'GND',endpoints:[{ref:'c',pin:'1'}]}]}};
  await writeFile(dir+'/work-project.json',JSON.stringify({kind:'task_work_project',sessionId:'work',projectUuid:'project',schematicPageUuid:'page',actions:{write:{state:'unknown'}}}));
  const a=new JlcEdaAdapter();a.invoke=async()=>{throw new Error('must not invoke');};const r=await a.dispatch('jlc_eda_finish_work_project',p);assert.equal(r.code,'WORK_ACTION_UNRESOLVED');assert.equal(r.editorWindowDestroyed,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('finish requires associated PCB even before sync and retains target before any focus',async()=>{
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'p2cr1-finish-pcb-')));try{
  const circuit={components:[{ref:'c',designator:'U1',deviceUuid:'device',libraryUuid:'lib',supplierId:'supplier',manufacturerPart:'part',footprintUuid:'fp',pose:{x:0,y:0}}],nets:[{name:'GND',endpoints:[{ref:'c',pin:'1'}]}],nc:[],notes:[]};
  const p={workDirectory:dir,sessionId:'work',expectedProjectUuid:'project',schematicPageUuid:'page',requestId:'finish',circuit};
  await writeFile(dir+'/work-project.json',JSON.stringify({kind:'task_work_project',sessionId:'work',projectUuid:'project',schematicPageUuid:'page',schematicUuid:'root',pcbDocumentUuid:'pcb',circuit:circuitSchema.parse(circuit),actions:{}}));
  const a=new JlcEdaAdapter();a.invoke=async()=>{throw new Error('must not invoke');};const r=await a.dispatch('jlc_eda_finish_work_project',p);assert.equal(r.code,'FINISH_ASSOCIATED_PCB_REQUIRED');assert.equal(r.editorWindowDestroyed,false);
 }finally{await rm(dir,{recursive:true,force:true});}
});
