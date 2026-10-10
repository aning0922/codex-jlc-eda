import {mkdtemp,realpath,readFile,writeFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {digest} from '../src/facts.mjs';
import {fingerprint} from '../src/drawing.mjs';
import {incrementalSchemas} from '../src/incremental.mjs';
export const phases=incrementalSchemas.jlc_eda_incremental_pcb.shape.phase.options;
export async function closedFixture(t,Adapter,{journalPath}={}){
 const dir=await realpath(await mkdtemp(path.join(os.tmpdir(),'EDA 完成复用-')));
 t?.after(()=>rm(dir,{recursive:true,force:true}));
 const sourcePath=path.join(dir,'source.eprj2'),workPath=path.join(dir,'work.eprj2'),checkpointPath=path.join(dir,'source-checkpoint.json'),recordPath=path.join(dir,'work-project.json');
 let record,source,work,checkpoint;
 if(journalPath){record=JSON.parse(await readFile(journalPath,'utf8'));source=await readFile(record.source.path);work=await readFile(record.path);checkpoint=record.source.checkpointPath?await readFile(record.source.checkpointPath):Buffer.from('{}');}
 else{source=Buffer.from('closed source fixture');work=Buffer.from('independently verified work fixture');checkpoint=Buffer.from('{"state":"closed source"}');const input=incrementalSchemas.jlc_eda_incremental_pcb.shape.changes.parse({labels:[{ref:'C1',heightMm:1}]});record={kind:'incremental_pcb_work_project',requestId:'closed-fixture',source:{sha256:digest(source)},incrementPlan:{plan:{input},inputFingerprint:fingerprint(input)},finish:{state:'closed',sourceSha256:digest(work),closed:{sessionNoLongerAlive:true},result:{status:'ok',persistenceVerified:true,fullDesignArchiveCompared:true}}};}
 record.path=workPath;record.source.path=sourcePath;record.source.checkpointPath=checkpointPath;record.source.checkpointSha256=digest(checkpoint);record.finish.result.path=workPath;record.finish.result.workDirectory=dir;
 await Promise.all([writeFile(sourcePath,source),writeFile(workPath,work),writeFile(checkpointPath,checkpoint)]);
 const writeRecord=()=>writeFile(recordPath,JSON.stringify(record,null,2)+'\n');await writeRecord();
 const calls={cli:0,native:0,context:0};const adapter=new Adapter({executable:'/unused',runner:async()=>{calls.cli++;throw Error('CLOSED_MUST_NOT_CALL_CLI');}});
 for(const name of ['invoke','invokeLossless'])adapter[name]=async()=>{calls.native++;throw Error('CLOSED_MUST_NOT_INVOKE');};
 for(const name of ['ensureWorkWindowBudget','destroyOwnedSession','openInspectionContext'])adapter[name]=async()=>{calls.context++;throw Error('CLOSED_MUST_NOT_OPEN_OR_CLOSE');};
 return {dir,sourcePath,workPath,checkpointPath,recordPath,record,writeRecord,work,source,checkpoint,calls,adapter,changes:record.incrementPlan.plan.input,params:{sourcePath,outputDirectory:dir,requestId:record.requestId},
  async checkCalls(fn){const before=await readFile(recordPath);const result=await fn();assert.deepEqual(await readFile(recordPath),before,'closed cache must never rewrite its journal');assert.deepEqual(calls,{cli:0,native:0,context:0});return result;},
  cleanup:()=>rm(dir,{recursive:true,force:true})};
}
