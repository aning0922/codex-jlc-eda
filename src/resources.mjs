import{parseNativeSource}from'./native-records.mjs';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {unzipSync,strFromU8} from 'fflate';
import {fingerprint} from './drawing.mjs';
export class ResourceLedger{
 constructor(root){this.root=path.join(root,'resources');this.ownerId=randomUUID();this.entries=new Map();}
 async register(info){const record={...info,ownerId:this.ownerId,ownerPid:process.pid,state:'active',createdAt:new Date().toISOString()};this.entries.set(info.sessionId,record);await this.save(record);return record;}
 async save(record){await mkdir(this.root,{recursive:true});await writeFile(path.join(this.root,record.sessionId+'.json'),JSON.stringify(record,null,2)+'\n');}
 async update(sid,fields){const r=this.entries.get(sid);if(!r)return;Object.assign(r,fields);await this.save(r);return r;}
 async all(){await mkdir(this.root,{recursive:true});const results=[];for(const file of await readdir(this.root)){if(!/^[\w-]+\.json$/.test(file))continue;try{results.push(JSON.parse(await readFile(path.join(this.root,file),'utf8')));}catch{}}return results;}
}
export const resourceIdentityScript=`(async()=>({status:'ok',anchor:eda.sys_Window.getUrlAnchor(),projectUuid:(await eda.dmt_Project.getCurrentProjectInfo())?.uuid??null}))()`;
export function resourceAnchorPath(anchor){
 const raw=String(anchor).replace(/^.*?#/,''),p=new URLSearchParams(raw);let value=p.get('prjPath')??raw.match(/(?:^|[,&#])prjPath=([^,&#]*)/)?.[1];
 if(!value)return null;for(let i=0;i<3&&/%[\da-f]{2}/i.test(value);i++){try{const next=decodeURIComponent(value);if(next===value)break;value=next;}catch{return null;}}
 return value;
}
// Keep every native design record (including notes/graphics), ignoring only
// DOCHEAD save/client/ticket metadata. No geometry or expected circuit is invented.
export function archiveDesignFingerprint(data){
 const files=unzipSync(Buffer.from(data,'base64')),docs=[];let current;
 for(const [name,bytes] of Object.entries(files)){
  if(!name.endsWith('.epru'))continue;
  for(const {header:h,body:b,deleted}of parseNativeSource(strFromU8(bytes))){
   if(h.type==='DOCHEAD'){if(!b.uuid||!b.docType)throw new Error('Missing archive document identity');current={uuid:b.uuid,docType:b.docType,records:[],tombstones:[]};docs.push(current);}
   else{if(!current)throw new Error('Unbound archive record');(deleted?current.tombstones:current.records).push({type:h.type,id:h.id??null,body:b});}
  }
 }
 if(!docs.length)throw new Error('No native design records');
 for(const d of docs)d.records.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
 docs.sort((a,b)=>(a.docType+'/'+a.uuid).localeCompare(b.docType+'/'+b.uuid));
 return {sha256:fingerprint(docs.map(({tombstones,...d})=>d)),tombstones:docs.flatMap(d=>d.tombstones.map(t=>({documentUuid:d.uuid,...t}))),documents:docs.map(d=>({uuid:d.uuid,docType:d.docType,records:d.records.length})),coverage:'all active native pipe records; atomic deletion identities reported separately and checked by preservation; DOCHEAD volatile save/client metadata omitted'};
}
export async function withFreshRead(a,file,operation){
 let fresh,result,cleanup;
 try{fresh=await a.openInspectionProject({path:file},{fresh:true});result=await operation(fresh);}
 catch(e){result={status:e.status??'unknown',code:e.code??'FRESH_READ_FAILED',message:e.message,persistenceVerified:false};}
 finally{
  if(fresh?.freshDiskContext&&fresh.inspectionCopy&&!fresh.reusedOwnedSession&&fresh.sessionId&&a.ownedSessions.has(fresh.sessionId)){
   try{cleanup=await a.destroyOwnedSession(fresh.sessionId);}catch(e){cleanup={status:'unknown',code:e.code??'RESOURCE_CLEANUP_FAILED',message:e.message};}
  }
 }
 return {...result,resourceCleanup:cleanup??result?.resourceCleanup??{status:'not_owned',reason:'No newly owned session was created'},
  ...(cleanup&&cleanup.status!=='ok'?{cleanupRequired:true}: {})};
}
