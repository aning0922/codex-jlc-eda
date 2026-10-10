import {readdir, mkdtemp, cp, rm, stat} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawnSync} from 'node:child_process';
const group=process.argv[2]??'offline';
if(!['offline','fixtures'].includes(group))throw Error('Unknown test group');
const root=new URL('../',import.meta.url),env={...process.env};
const fixtureKeys=['MANUFACTURING_FIXTURE_DIRECTORY','PASSIVE_MANUFACTURING_FIXTURE_DIRECTORY','INCREMENTAL_NATIVE_ADOPTION_FIXTURE','INCREMENTAL_CLOSED_WORK_FIXTURE','PASSIVE_REAL_FIXTURE'];
let temp;
try {
 if(group==='fixtures'){
  const missing=fixtureKeys.filter(k=>!env[k]);
  if(missing.length)throw Error('Private fixture group requires: '+missing.join(', ')+'. See docs/testing.md. No tests were run.');
  for(const k of fixtureKeys)await stat(env[k]);
  temp=await mkdtemp(path.join(os.tmpdir(),'jlc-private-fixtures-'));
  // The analyzers write reports: always use fresh copies, never original delivery evidence.
  for(const k of ['MANUFACTURING_FIXTURE_DIRECTORY','PASSIVE_MANUFACTURING_FIXTURE_DIRECTORY']){
   const target=path.join(temp,k);await cp(env[k],target,{recursive:true});env[k]=target;
  }
 }else for(const k of fixtureKeys)delete env[k];
 delete env.INCREMENTAL_CLOSED_EVIDENCE_FILE;
 const dir=group==='offline'?'tests':'tests/integration';
 const files=(await readdir(new URL(dir+'/',root))).filter(x=>x.endsWith('.test.mjs')).sort().map(x=>dir+'/'+x);
 if(group==='offline')files.push('.build/board-geometry.test.mjs');
 const run=spawnSync(process.execPath,['--test','--test-reporter=tap',...files],{cwd:root,env,encoding:'utf8',maxBuffer:32*1024*1024});
 process.stdout.write(run.stdout??'');process.stderr.write(run.stderr??'');
 if(run.error)throw run.error;
 const counts=Object.fromEntries([...run.stdout.matchAll(/^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
 console.log(JSON.stringify({group,...counts,realEdaExecuted:false,privateFixturesIncluded:group==='fixtures'}));
 if(run.status!==0||!counts.tests||counts.skipped||counts.todo||counts.cancelled)process.exitCode=1;
}finally{if(temp)await rm(temp,{recursive:true,force:true});}
