import {z} from 'zod';
import {readFile,writeFile,mkdir,readdir,realpath,stat} from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {scripts} from './native-scripts.mjs';
import {pcbScript,association} from './pcb.mjs';
import {archiveDesignFingerprint} from './resources.mjs';
import {losslessView} from './file-checkpoint.mjs';
import {readOwnedRouting} from './p3.mjs';
import {analyzeDelivery,deliveryManifest} from './manufacturing-files.mjs';
import {refreshManufacturingPreviews} from './manufacturing-previews.mjs';
export const manufacturingSchemas={jlc_eda_export_manufacturing:z.object({sourcePath:z.string().min(1).max(4096),outputDirectory:z.string().min(1).max(4096),requestId:z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),boardName:z.string().min(1).max(160).optional(),phase:z.enum(['generate','verify','refresh_previews']).default('generate'),assembly:z.enum(['reflow','hand']).default('reflow'),viaTreatment:z.enum(['unspecified','tented','filled_capped']).default('unspecified')}).strict()};
const sha=b=>createHash('sha256').update(b).digest('hex');
const fail=(code,status='failed')=>{throw Object.assign(Error(code),{code,status});};
const json=async(f,v)=>writeFile(f,JSON.stringify(v,null,2)+'\n');
async function manufactureNative(p){
 const matches=async()=>{const project=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();return project?.uuid===p.expectedProjectUuid&&doc?.uuid===p.pcbDocumentUuid&&doc?.parentProjectUuid===p.expectedProjectUuid&&doc?.documentType===3;};
 if(!await matches())return {status:'failed',code:'MANUFACTURE_TARGET_MISMATCH'};
 if(p.kind==='label_bounds'){const attrs=await eda.pcb_PrimitiveAttribute.getAll(),rows=[];for(const a of attrs.filter(a=>a.getState_Key()==='Designator'&&a.getState_ValueVisible()&&a.getState_Layer()===3)){const id=a.getState_PrimitiveId();rows.push({id,ref:a.getState_Value(),x:a.getState_X(),y:a.getState_Y(),fontSize:a.getState_FontSize(),lineWidth:a.getState_LineWidth(),rotation:a.getState_Rotation(),bounds:await eda.pcb_Primitive.getPrimitivesBBox([id])});}return {status:await matches()?'ok':'unknown',rows,units:'mil',source:'public native attribute and primitive bounding boxes'};}
 const api=eda.pcb_ManufactureData;
 const availability={gerber:typeof api.getGerberFile,bom:typeof api.getBomFile,placements:typeof api.getPickAndPlaceFile};
 if(Object.values(availability).some(x=>x!=='function'))return {status:'unsupported',code:'MANUFACTURE_API_UNAVAILABLE',availability};
 let f;
 if(p.kind==='gerber')f=await api.getGerberFile('fabrication',false,'mm',{integerNumber:4,decimalNumber:5},{metallicDrillingInformation:true,nonMetallicDrillingInformation:true,drillTable:true,flyingProbeTestingFile:true});
 if(p.kind==='bom')f=await api.getBomFile('bom','csv');
 if(p.kind==='placements')f=await api.getPickAndPlaceFile('placements','csv','mm');
 if(!f||!f.size||f.size>12*1024*1024)return {status:'unknown',code:'MANUFACTURE_FILE_UNAVAILABLE_OR_TOO_LARGE',availability};
 let s='';for(const b of new Uint8Array(await f.arrayBuffer()))s+=String.fromCharCode(b);
 return {status:await matches()?'ok':'unknown',code:await matches()?undefined:'MANUFACTURE_TARGET_CHANGED',availability,fileName:f.name,mimeType:f.type,bytes:f.size,data:btoa(s)};
}
export const manufactureScript=p=>'('+manufactureNative.toString()+')('+JSON.stringify(p)+')';
export async function verifyDelivery(root,sourcePath,request){
 const j=JSON.parse(await readFile(path.join(root,'delivery.json'),'utf8'));
 if(sha(await readFile(sourcePath))!==j.sourceSha256||j.requestKey!==request)fail('MANUFACTURE_SOURCE_OR_REQUEST_CHANGED');
 if(!j.captureComplete||j.designUnchanged!==true||j.sourceUnchanged!==true)fail('MANUFACTURE_CAPTURE_INCOMPLETE','unknown');
 for(const e of Object.values(j.exports)){const b=await readFile(path.join(root,e.file));if(e.state!=='completed'||b.length!==e.bytes||sha(b)!==e.sha256)fail('MANUFACTURE_CAPTURE_FILE_CHANGED');}
 const before=archiveDesignFingerprint((await readFile(path.join(root,'native-before.zip'))).toString('base64')),after=archiveDesignFingerprint((await readFile(path.join(root,'native-after.zip'))).toString('base64'));if(before.sha256!==j.designBefore.sha256||after.sha256!==j.designAfter.sha256||before.sha256!==after.sha256)fail('MANUFACTURE_CAPTURE_DESIGN_CHANGED');
 if(j.manifest){for(const f of j.manifest)if(sha(await readFile(path.join(root,f.path)))!==f.sha256)fail('MANUFACTURE_DELIVERY_FILE_CHANGED');return {...j.result,reusedVerifiedDelivery:true,resourceCleanup:j.resourceCleanup};}
 const checks=await analyzeDelivery(root,j);
 await json(path.join(root,'checks.json'),checks);
 if(sha(await readFile(sourcePath))!==j.sourceSha256)fail('MANUFACTURE_SOURCE_CHANGED_DURING_ANALYSIS');
 const manifest=await deliveryManifest(root);await json(path.join(root,'manifest.json'),{sourceSha256:j.sourceSha256,files:manifest,coverage:'all delivery files except manifest.json and delivery.json (self-referential control records)'});
 j.manifest=manifest;j.state='completed';j.result={status:j.resourceCleanup?.status==='ok'?'ok':'unknown',...(j.resourceCleanup?.status!=='ok'?{code:'MANUFACTURE_RESOURCE_CLEANUP_UNCONFIRMED',cleanupRequired:true}:{}),deliveryGenerated:checks.filesValid,manufacturingReady:checks.manufacturingReady,manufacturingStatus:checks.manufacturingStatus,outputDirectory:root,reportPath:path.join(root,'制造检查报告.md'),manifestPath:path.join(root,'manifest.json'),checksPath:path.join(root,'checks.json'),sourceSha256:j.sourceSha256,designUnchanged:true,sourceUnchanged:true,issues:checks.issues,resourceCleanup:j.resourceCleanup};await json(path.join(root,'delivery.json'),j);return j.result;
}
export const manufacturingWorkflow={async jlc_eda_export_manufacturing(p){
 if(!path.isAbsolute(p.sourcePath)||!path.isAbsolute(p.outputDirectory))fail('MANUFACTURE_ABSOLUTE_PATH_REQUIRED','needs_input');
 const sourcePath=await realpath(p.sourcePath);if(!(await stat(sourcePath)).isFile()||! /\.eprj2$/i.test(sourcePath))fail('MANUFACTURE_EPRJ2_SOURCE_REQUIRED','unsupported');
 const sourceSha256=sha(await readFile(sourcePath)),resolvedOutput=path.resolve(p.outputDirectory);
 await mkdir(resolvedOutput,{recursive:true});const root=await realpath(resolvedOutput);
 if(root===path.dirname(sourcePath)||sourcePath.startsWith(root+path.sep))fail('MANUFACTURE_OUTPUT_SOURCE_OVERLAP');
 const key=sha(JSON.stringify({sourcePath,sourceSha256,root,requestId:p.requestId,boardName:p.boardName??null,assembly:p.assembly,viaTreatment:p.viaTreatment}));
 if(p.phase==='verify')return verifyDelivery(root,sourcePath,key);
 if(p.phase==='refresh_previews'){const original=await verifyDelivery(root,sourcePath,key);return {...await refreshManufacturingPreviews(root),deliveryGenerated:original.deliveryGenerated,manufacturingReady:original.manufacturingReady,manufacturingStatus:original.manufacturingStatus,originalReportPath:original.reportPath};}
 await mkdir(root,{recursive:true});const entries=await readdir(root);
 if(entries.length){if(!entries.includes('delivery.json'))fail('MANUFACTURE_OUTPUT_NOT_EMPTY');return verifyDelivery(root,sourcePath,key);}
 let fresh,j={requestKey:key,requestId:p.requestId,sourcePath,sourceSha256,assembly:p.assembly,viaTreatment:p.viaTreatment,state:'capturing',captureComplete:false,exports:{},createdAt:new Date().toISOString()},error;
 await json(path.join(root,'delivery.json'),j);
 const a=losslessView(this);
 try{
 fresh=await a.openInspectionProject({path:sourcePath},{fresh:true});await json(path.join(root,'inspection.json'),fresh);
 if(fresh.status!=='ok'||!fresh.freshDiskContext||!fresh.inspectionCopy)fail(fresh.code??'MANUFACTURE_FRESH_INSPECTION_REQUIRED','unknown');
 const boards=fresh.boards.filter(b=>!p.boardName||b.name===p.boardName);if(boards.length!==1||boards[0].schematicPageUuids?.length!==1)fail('MANUFACTURE_SINGLE_BOARD_PAGE_REQUIRED','unsupported');
 const board=boards[0],target={sessionId:fresh.sessionId,expectedProjectUuid:fresh.project.uuid,pcbDocumentUuid:board.pcbDocumentUuid,schematicUuid:board.schematicUuid,schematicPageUuid:board.schematicPageUuids[0]};
 if(association(fresh,target).status!=='ok')fail('MANUFACTURE_BOARD_ASSOCIATION_UNPROVEN');j.target=target;j.boardName=board.name;j.inspectionPath=fresh.path;
 const focus=await a.invoke(target.sessionId,scripts.focus({...target,documentUuid:target.pcbDocumentUuid,kind:'pcb'}));if(focus.status!=='ok')fail(focus.code??'MANUFACTURE_FOCUS_FAILED');
 const document=await a.jlc_eda_read_document({...target,documentUuid:target.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
 if(document.status!=='ok'||document.truncated!==false||document.components.length!==document.counts.components)fail('MANUFACTURE_DOCUMENT_INCOMPLETE');
 await json(path.join(root,'pcb-document.json'),document);
 const connectivity=await a.jlc_eda_read_connectivity(target);await json(path.join(root,'connectivity.json'),connectivity);
 if(connectivity.status!=='ok'||connectivity.comparison?.status!=='matched')fail('MANUFACTURE_CONNECTIVITY_MISMATCH');
 const refocus=await a.invoke(target.sessionId,scripts.focus({...target,documentUuid:target.pcbDocumentUuid,kind:'pcb'}));if(refocus.status!=='ok')fail('MANUFACTURE_FOCUS_FAILED');
 const native=await readOwnedRouting(a,target);if(native.status!=='ok')fail(native.code??'MANUFACTURE_NATIVE_UNAVAILABLE');await json(path.join(root,'routing.json'),native);
 const labels=await a.invoke(target.sessionId,manufactureScript({...target,kind:'label_bounds'}));await json(path.join(root,'text-bounds-native.json'),labels);
 const before=await a.invoke(target.sessionId,pcbScript({...target,operation:'archive'}));if(before.status!=='ok')fail('MANUFACTURE_ARCHIVE_UNAVAILABLE');
 await writeFile(path.join(root,'native-before.zip'),Buffer.from(before.data,'base64'));j.designBefore=archiveDesignFingerprint(before.data);await json(path.join(root,'delivery.json'),j);
 for(const [kind,file]of [['gerber','fabrication.zip'],['bom','bom-native.csv'],['placements','placements-native.csv']]){
  j.exports[kind]={state:'pending',file};await json(path.join(root,'delivery.json'),j);
  const x=await a.invoke(target.sessionId,manufactureScript({...target,kind}),60000);if(x.status!=='ok')fail(x.code??'MANUFACTURE_EXPORT_UNCONFIRMED','unknown');
  const bytes=Buffer.from(x.data,'base64');if(bytes.length!==x.bytes)fail('MANUFACTURE_FILE_LENGTH_MISMATCH');
  await writeFile(path.join(root,file),bytes,{flag:'wx'});delete x.data;j.exports[kind]={state:'completed',file,...x,sha256:sha(bytes)};await json(path.join(root,'delivery.json'),j);
 }
 const preview=await a.invoke(target.sessionId,pcbScript({...target,operation:'preview'}),60000);if(preview.status==='ok'){await writeFile(path.join(root,'pcb-native.png'),Buffer.from(preview.data,'base64'));j.preview={status:'ok',mimeType:preview.mimeType};}else j.preview=preview;
 const after=await a.invoke(target.sessionId,pcbScript({...target,operation:'archive'}));if(after.status!=='ok')fail('MANUFACTURE_FINAL_ARCHIVE_UNAVAILABLE');
 await writeFile(path.join(root,'native-after.zip'),Buffer.from(after.data,'base64'));j.designAfter=archiveDesignFingerprint(after.data);j.designUnchanged=j.designBefore.sha256===j.designAfter.sha256;j.sourceUnchanged=sourceSha256===sha(await readFile(sourcePath));if(!j.designUnchanged||!j.sourceUnchanged)fail('MANUFACTURE_SOURCE_OR_DESIGN_CHANGED','unknown');j.captureComplete=true;j.state='captured';
 }catch(e){error=e;j.state='capture_failed';j.error={code:e.code??'MANUFACTURE_CAPTURE_FAILED',message:e.message};}
 finally{
  if(fresh?.sessionId&&a.ownedSessions.has(fresh.sessionId))j.resourceCleanup=await a.destroyOwnedSession(fresh.sessionId).catch(e=>({status:'unknown',code:e.code??'MANUFACTURE_CLEANUP_FAILED'}));else j.resourceCleanup=fresh?.resourceCleanup??{status:'not_owned'};
  await json(path.join(root,'delivery.json'),j);
 }
 if(error)return {status:error.status??'unknown',code:error.code??'MANUFACTURE_CAPTURE_FAILED',message:error.message,outputDirectory:root,deliveryGenerated:false,manufacturingReady:false,resourceCleanup:j.resourceCleanup,nextAction:'Do not repeat native exports. Inspect delivery.json and captured files. verify can process a complete unchanged capture without opening EDA.'};
 return verifyDelivery(root,sourcePath,key);
}};
