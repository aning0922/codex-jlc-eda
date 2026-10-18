import {mkdir,readFile,writeFile,realpath,lstat,readdir} from 'node:fs/promises';
import path from 'node:path';
import {digest} from './facts.mjs';
import {fingerprint} from './drawing.mjs';
import {withFreshRead} from './resources.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:'failed'});};
async function nativeImport(p){
 if((await eda.dmt_Project.getCurrentProjectInfo())?.uuid!==p.expectedProjectUuid)
  return {status:'failed',code:'PROJECT_IMPORT_CONTEXT_CHANGED',nativeMutationRequested:false};
 if(typeof eda.sys_FileManager.importProjectByProjectFile!=='function')
  return {status:'unsupported',code:'PROJECT_IMPORT_API_UNAVAILABLE',nativeMutationRequested:false};
 const bytes=Uint8Array.from(atob(p.data),c=>c.charCodeAt(0)),file=new File([bytes],p.fileName,{type:'application/zip'});
 try{
  const project=await eda.sys_FileManager.importProjectByProjectFile(file,'JLCEDA Pro',
   {importOption:'ImportDocument',schematicObjectStyle:'custom'},
   {operation:'Offline Client Local Path',folderPath:p.folderPath});
  return {status:project?'returned':'unknown',project:project??null,nativeMutationRequested:true};
 }catch(e){return {status:'unknown',code:'PROJECT_IMPORT_NATIVE_ERROR',message:e?.message??String(e),nativeMutationRequested:true};}
}
export const projectImportScript=p=>'('+nativeImport.toString()+')('+JSON.stringify(p)+')';
export async function importLocalProject(a,p){
 const input=p.projectImport;
 if(!path.isAbsolute(input.sourcePath)||!path.isAbsolute(p.outputDirectory))fail('PROJECT_IMPORT_ABSOLUTE_PATH_REQUIRED');
 const source=await realpath(input.sourcePath),s=await lstat(source);
 if(!s.isFile()||!(/\.epro2?$/i.test(source))||s.size===0||s.size>8*1024*1024)fail('PROJECT_IMPORT_EXCHANGE_FILE_REQUIRED');
 const bytes=await readFile(source);if(bytes[0]!==80||bytes[1]!==75)fail('PROJECT_IMPORT_EXCHANGE_FORMAT_UNSUPPORTED');
 const hash=digest(bytes),request=fingerprint({requestId:p.requestId,source,sourceSha256:hash,sessionId:input.sessionId,expectedProjectUuid:input.expectedProjectUuid});
 let dir,record;
 try{await mkdir(p.outputDirectory);dir=await realpath(p.outputDirectory);}catch(e){
  if(e.code!=='EEXIST')throw e;dir=await realpath(p.outputDirectory);
  try{record=JSON.parse(await readFile(path.join(dir,'project-import.json'),'utf8'));}catch{fail('PROJECT_IMPORT_OUTPUT_EXISTS');}
  if(record.request!==request)fail('PROJECT_IMPORT_REQUEST_CONFLICT');
  if(record.state!=='completed')return {status:'unknown',code:'PROJECT_IMPORT_OUTCOME_RETAINED',record,nativeMutationReplayed:false,nextAction:'Inspect the recorded output; this import is never repeated.'};
  if(!record.path||digest(await readFile(record.path))!==record.outputSha256)fail('PROJECT_IMPORT_COMPLETED_FILE_CHANGED');
  return {...record.result,reused:true,nativeMutationReplayed:false};
 }
 if(source.startsWith(dir+path.sep))fail('PROJECT_IMPORT_SOURCE_OVERLAP');
 const folder=path.join(dir,'native-output');await mkdir(folder);
 const persist=()=>writeFile(path.join(dir,'project-import.json'),JSON.stringify(record,null,2)+'\n');
 record={kind:'local_project_import',request,state:'pending',source,sourceSha256:hash,folder,requestId:p.requestId,startedAt:new Date().toISOString()};await persist();
 try{
  record.native=await a.invoke(input.sessionId,projectImportScript({...input,folderPath:folder,fileName:path.basename(source),data:bytes.toString('base64')}),60000);
  record.state='unknown';await persist();
  record.entries=await readdir(folder,{withFileTypes:true}).then(xs=>xs.map(x=>({name:x.name,directory:x.isDirectory(),file:x.isFile()})));
  if(digest(await readFile(source))!==hash)fail('PROJECT_IMPORT_SOURCE_CHANGED');
  if(record.native.status!=='returned')return {status:record.native.status,code:record.native.code??'PROJECT_IMPORT_UNCONFIRMED',native:record.native,outputDirectory:dir,nativeMutationReplayed:false};
  const candidates=record.entries.filter(x=>x.file&&x.name.endsWith('.eprj2'));
  if(candidates.length!==1||record.entries.length!==1){record.state='unsupported_result';await persist();return {status:'unsupported',code:'PROJECT_IMPORT_RESULT_FORMAT_UNSUPPORTED',project:record.native.project,entries:record.entries,outputDirectory:dir,nativeMutationReplayed:false};}
  const file=await realpath(path.join(folder,candidates[0].name));
  if(path.dirname(file)!==folder||digest(file)!==record.native.project?.uuid)fail('PROJECT_IMPORT_RETURNED_IDENTITY_UNPROVEN');
  const outputSha256=digest(await readFile(file));
  const readback=await withFreshRead(a,file,async fresh=>fresh);
  if(readback.status!=='ok'||readback.sourceSha256!==outputSha256||readback.resourceCleanup?.status!=='ok'){
   record.readback=readback;await persist();return {status:'unknown',code:'PROJECT_IMPORT_READBACK_UNVERIFIED',readback,outputDirectory:dir};
  }
  record.state='completed';record.path=file;record.outputSha256=outputSha256;
  record.result={status:'ok',importOnly:true,editableBindingGranted:false,path:file,sourceSha256:hash,outputSha256,project:record.native.project,readback,outputDirectory:dir};
  await persist();return record.result;
 }catch(e){record.state='unknown';record.error={code:e.code,message:e.message};await persist();throw e;}
 finally{if(record.entries)await persist();}
}
