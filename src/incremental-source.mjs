import{parseNativeSource}from'./native-records.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {fingerprint} from './drawing.mjs';
import {nativeModelRecords,proveStoredPadContainedLines} from './file-model-evidence.mjs';
import {extractNativeCopper} from './native-copper-evidence.mjs';
import {compareRoutingCheckpoint} from './p3.mjs';
export const parseSource=source=>parseNativeSource(source).filter(r=>!r.deleted);
export const serializeSource=rows=>rows.map(r=>JSON.stringify(r.header)+'||'+JSON.stringify(r.body)+'|').join('\n')+'\n';
export function archiveSources(data){const files=unzipSync(Buffer.from(data,'base64')),docs=new Map();for(const [name,bytes]of Object.entries(files))if(name.endsWith('.epru')){let rows=[];const add=()=>{if(!rows.length)return;const head=rows[0].body;if(!head?.uuid||docs.has(head.uuid))throw Error('INCREMENT_SOURCE_DOCUMENT_AMBIGUOUS');docs.set(head.uuid,{source:serializeSource(rows.filter(r=>!r.deleted)),rows:rows.filter(r=>!r.deleted),tombstones:rows.filter(r=>r.deleted),head,name});};for(const row of parseNativeSource(strFromU8(bytes))){if(row.header.type==='DOCHEAD'){add();rows=[];}rows.push(row);}add();}return docs;}
export function recordFingerprint(source){return fingerprint(parseSource(source).filter(r=>r.header.type!=='DOCHEAD').map(r=>({type:r.header.type,id:r.header.id,body:r.body})).sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b))));}
export function physicalRead(data,document,api,reference){
 const docs=nativeModelRecords(data),pcb=docs.get(document.documentUuid),stored=extractNativeCopper(data,document.documentUuid,{native:api,document}),objects=[];
 for(const row of stored.rows){const b=row.body;if(row.type==='LINE')objects.push({kind:'Line',primitiveId:row.id,net:b.netName,layer:b.layerId,startX:b.startX,startY:b.startY,endX:b.endX,endY:b.endY,lineWidth:b.width,primitiveLock:b.locked});else if(row.type==='VIA')objects.push({kind:'Via',primitiveId:row.id,net:b.netName,x:b.centerX,y:b.centerY,diameter:b.viaDiameter,holeDiameter:b.holeDiameter,viaType:b.viaType==='NORMAL'?0:-1,primitiveLock:b.locked});else if(row.type==='FOOTPRINT_VIA'){const x=api.objects.find(x=>x.primitiveId===row.id);if(!x)throw Error('INCREMENT_OWNED_VIA_MISSING');objects.push(x);}else if(row.type==='POLY'){const x=api.objects.find(x=>x.primitiveId===row.id);if(!x)throw Error('INCREMENT_POLY_MISSING');objects.push(x);}}
 if(api.objects.some(x=>!objects.some(y=>y.primitiveId===x.primitiveId)))throw Error('INCREMENT_API_EXTRA_OBJECT');
 const omitted=objects.filter(x=>!api.objects.some(y=>y.primitiveId===x.primitiveId)),proofs=[];
 for(const x of omitted){const old=reference?.rows.find(r=>r.id===x.primitiveId),now=stored.rows.find(r=>r.id===x.primitiveId);if(x.kind!=='Line'||Math.hypot(x.endX-x.startX,x.endY-x.startY)>.1||reference&&(!old||fingerprint(old)!==fingerprint(now)))throw Error('INCREMENT_MISSING_COPPER_UNPROVEN');}
 if(omitted.length)proofs.push(proveStoredPadContainedLines(data,document,omitted));
 const projection=[];
 for(const x of api.objects){const raw=objects.find(y=>y.primitiveId===x.primitiveId);if(x.kind==='Via'&&!x.componentOwnership){for(const k of ['diameter','holeDiameter'])if(raw[k]!==x[k]){const nominal=Math.round(raw[k]/2*10+1e-10)/10*2;if(nominal!==x[k])throw Error('INCREMENT_VIA_PROJECTION_UNPROVEN');projection.push({id:x.primitiveId,field:k,stored:raw[k],api:x[k],exactSdkNominal:nominal});}}
  const normalized=x.kind==='Via'&&!x.componentOwnership?{...x,diameter:raw.diameter,holeDiameter:raw.holeDiameter}:x;
  if(compareRoutingCheckpoint({...api,objects:[raw]},{...api,objects:[normalized]},{compareRules:false}).status!=='matched')throw Error('INCREMENT_API_RAW_MISMATCH');
 }
 return {native:{...api,objects},stored,apiCount:api.objects.length,physicalCount:objects.length,omitted,proofs,projection,pcbRows:pcb.rows};
}
