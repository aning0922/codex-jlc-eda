import {readFile,readdir,realpath} from 'node:fs/promises';
import path from 'node:path';import {createHash} from 'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
export function inspectRoutingRegistration(ui,api){
 const match=ui.match(/PCB_Document:\{([^{}]*)\},PCB_PrimitivePad:/),declared=api.includes('extensionApi.PCB_Document.autoRouting');
 if(!match)return {status:'unknown',code:'PCB_ROUTING_REGISTRY_FORMAT_UNSUPPORTED',sdkDeclared:declared,mutationRequested:false};
 const registered=/(?:^|,)autoRouting:/.test(match[1]);
 return {status:declared&&registered?'supported':'unsupported',code:declared&&registered?'PCB_ROUTING_LOCAL_BRIDGE_PRESENT':'PCB_NATIVE_ROUTING_BRIDGE_UNAVAILABLE',sdkDeclared:declared,installedBridgeRegistered:registered,executionVerified:false,mutationRequested:false,registry:match[0],meaning:'Installed SDK and bundled official UI registration only; does not prove engine run, original request dispatch, or cancellation.'};
}
export async function installedRoutingCapability(executable){
 try{
  const exe=await realpath(executable),app=path.resolve(path.dirname(exe),'../Resources/app'),assets=path.join(app,'assets');
  const one=async(kind,file)=>{const names=await readdir(path.join(assets,kind)),found=[];for(const n of names){const p=path.join(assets,kind,n,file);try{const bytes=await readFile(p);found.push({path:p,bytes});}catch{}}if(found.length!==1)throw Error('Ambiguous installed '+kind+' asset');return found[0];};
  const ui=await one('pro-ui','js/ui.js'),api=await one('pro-api','api.js'),version=JSON.parse(await readFile(path.join(app,'package.json'),'utf8')).version;
  return {...inspectRoutingRegistration(ui.bytes.toString(),api.bytes.toString()),installedVersion:version,officialExecutable:exe,ui:{path:ui.path,sha256:sha(ui.bytes)},api:{path:api.path,sha256:sha(api.bytes)},source:'read-only installed official assets; no private RPC or source modification'};
 }catch(e){return {status:'unknown',code:'PCB_ROUTING_CAPABILITY_UNVERIFIED',message:e.message,mutationRequested:false};}
}
