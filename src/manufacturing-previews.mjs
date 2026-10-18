import {readFile,writeFile,mkdir} from 'node:fs/promises';import path from 'node:path';
import {unzipSync} from 'fflate';
import {sha,parseCam,overlaySvg,orientationSvg,deliveryManifest} from './manufacturing-files.mjs';
import {camGeometry,sourceCatalog} from './manufacturing-geometry.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:'unknown'});};
// Rebuild only derived views from a completely verified, immutable delivery.
// No editor/API export is performed and the original manifest remains intact.
export async function refreshManufacturingPreviews(root){
 const j=JSON.parse(await readFile(path.join(root,'delivery.json'))),files=['fabrication.zip','native-before.zip','pcb-document.json','checks.json'];
 if(j.state!=='completed'||!j.manifest||!j.captureComplete||!j.result?.deliveryGenerated)fail('PREVIEW_CAPTURE_NOT_COMPLETE');
 const bytes={},sourceHashes={};for(const name of files){bytes[name]=await readFile(path.join(root,name));sourceHashes[name]=sha(bytes[name]);if(j.manifest.find(f=>f.path===name)?.sha256!==sourceHashes[name])fail('PREVIEW_CAPTURE_CHANGED');}
 const target=root+'-previews',binding={rendererVersion:'origin-aware-v2',sourceDirectory:root,sourceSha256:j.sourceSha256,sourceHashes};
 try{await mkdir(target);}catch(e){if(e.code!=='EEXIST')throw e;let manifest;try{manifest=JSON.parse(await readFile(path.join(target,'manifest.json')));}catch{fail('PREVIEW_REVISION_INCOMPLETE_OR_UNOWNED');}
  if(JSON.stringify(manifest.binding)!==JSON.stringify(binding))fail('PREVIEW_REVISION_SOURCE_CONFLICT');for(const f of manifest.files)if(sha(await readFile(path.join(target,f.path)))!==f.sha256)fail('PREVIEW_REVISION_CHANGED');return {status:'ok',previewDirectory:target,reusedVerifiedPreviews:true,nativeExportReplayed:false};}
 await writeFile(path.join(target,'intent.json'),JSON.stringify(binding,null,2));
 const document=JSON.parse(bytes['pcb-document.json']),checks=JSON.parse(bytes['checks.json']),zip=unzipSync(bytes['fabrication.zip']),geometry={};
 for(const [name,value]of Object.entries(zip)){const ext=path.extname(name).toUpperCase();if(['.GTL','.GTS','.GTP'].includes(ext))geometry[ext]=camGeometry(parseCam(Buffer.from(value).toString('utf8')));}
 if(!['.GTL','.GTS','.GTP'].every(k=>geometry[k]?.complete)||checks.outlineCheck?.matched!==true)fail('PREVIEW_SOURCE_GEOMETRY_INCOMPLETE');
 const catalog=sourceCatalog(bytes['native-before.zip'].toString('base64'),document);
 await writeFile(path.join(target,'cam-overlay.svg'),overlaySvg(geometry['.GTL'],geometry['.GTP'],geometry['.GTS'],catalog,checks.outlineCheck));
 await writeFile(path.join(target,'assembly-orientation.svg'),orientationSvg(document));
 for(const name of files)if(sha(await readFile(path.join(root,name)))!==sourceHashes[name])fail('PREVIEW_CAPTURE_CHANGED_DURING_RENDER');
 await writeFile(path.join(target,'manifest.json'),JSON.stringify({binding,files:await deliveryManifest(target),nativeExportReplayed:false},null,2));
 return {status:'ok',previewDirectory:target,manifestPath:path.join(target,'manifest.json'),nativeExportReplayed:false,originalDeliveryUnchanged:true,sourceSha256:j.sourceSha256};
}
