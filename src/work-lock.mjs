import {createHash,randomUUID} from 'node:crypto';
import {mkdir,readdir,realpath,unlink,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

async function canonicalTarget(dir){
 try{return await realpath(dir);}
 catch(e){if(e.code!=='ENOENT')throw e;return path.join(await canonicalTarget(path.dirname(dir)),path.basename(dir));}
}

// Publish intent before checking contenders. A simultaneous collision may return busy to both callers.
export async function withWorkLock(directory,operation){
 const key=createHash('sha256').update(await canonicalTarget(path.resolve(directory))).digest('hex');
 const root=path.join(os.tmpdir(),'jlceda-work-locks-'+(process.getuid?.()??'user'),key);
 await mkdir(root,{recursive:true,mode:0o700});
 const name=process.pid+'-'+randomUUID(),ticket=path.join(root,name);
 await writeFile(ticket,'',{flag:'wx',mode:0o600});
 try{
  for(const other of await readdir(root)){
   if(other===name||!/^\d+-[\da-f-]+$/.test(other))continue;
   try{process.kill(Number(other.split('-')[0]),0);}
   catch(e){if(e.code==='ESRCH'){await unlink(path.join(root,other)).catch(err=>{if(err.code!=='ENOENT')throw err;});continue;}if(e.code!=='EPERM')throw e;}
   return {status:'needs_input',code:'WORK_OPERATION_IN_PROGRESS',nativeMutationRequested:false};
  }
  return await operation();
 }finally{await unlink(ticket);}
}
