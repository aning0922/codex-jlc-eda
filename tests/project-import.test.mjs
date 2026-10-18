import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {importLocalProject,projectImportScript} from '../src/project-import.mjs';
import {JlcEdaAdapter} from '../src/adapter.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
test('local import unknown is durable and cannot repeat or change source/request within its directory',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jlc-import-'));try{
  const source=path.join(root,'source.epro2');await writeFile(source,'PK fixture');const p={outputDirectory:path.join(root,'output'),requestId:'once',projectImport:{sourcePath:source,sessionId:'s',expectedProjectUuid:'p'}};let calls=0;
  const a={invoke:async()=>{calls++;throw Object.assign(Error('timeout'),{code:'CLI_TIMEOUT'});}};
  await assert.rejects(importLocalProject(a,p),e=>e.code==='CLI_TIMEOUT');assert.equal(calls,1);
  assert.equal((await importLocalProject(a,p)).code,'PROJECT_IMPORT_OUTCOME_RETAINED');assert.equal(calls,1);
  await assert.rejects(importLocalProject(a,{...p,requestId:'other'}),e=>e.code==='PROJECT_IMPORT_REQUEST_CONFLICT');
  await writeFile(source,'PK changed');await assert.rejects(importLocalProject(a,p),e=>e.code==='PROJECT_IMPORT_REQUEST_CONFLICT');assert.equal(calls,1);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('import input excludes native database containers and existing unknown output directories',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'jlc-import-'));try{const a={invoke:async()=>{throw Error('must not invoke');}},source=path.join(root,'native.eprj2');await writeFile(source,'PK fixture');const p={outputDirectory:path.join(root,'output'),requestId:'once',projectImport:{sourcePath:source,sessionId:'s',expectedProjectUuid:'p'}};
 await assert.rejects(importLocalProject(a,p),e=>e.code==='PROJECT_IMPORT_EXCHANGE_FILE_REQUIRED');p.projectImport.sourcePath=path.join(root,'source.epro');await writeFile(p.projectImport.sourcePath,'PK fixture');p.outputDirectory=root;await assert.rejects(importLocalProject(a,p),e=>e.code==='PROJECT_IMPORT_OUTPUT_EXISTS');
 }finally{await rm(root,{recursive:true,force:true});}
});
test('local import script rejects changed context before creating a File or invoking import',async()=>{
 const r=await new AsyncFunction('eda','return await '+projectImportScript({expectedProjectUuid:'expected'}))({dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'other'})}});assert.equal(r.nativeMutationRequested,false);assert.equal(r.code,'PROJECT_IMPORT_CONTEXT_CHANGED');
});
test('create tool keeps legacy inputs but requires exactly one source mode',async()=>{
 const a=new JlcEdaAdapter();for(const args of [{outputDirectory:'/out',requestId:'r'},{outputDirectory:'/out',requestId:'r',blankTemplatePath:'/template',projectImport:{sessionId:'s',expectedProjectUuid:'p',sourcePath:'/s.epro'}}])assert.equal((await a.dispatch('jlc_eda_create_work_project',args)).code,'INVALID_INPUT');
});
