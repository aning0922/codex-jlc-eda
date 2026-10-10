import{parseNativeSource}from'./native-records.mjs';
import {unzipSync,strFromU8,strToU8,zipSync} from 'fflate';import {fingerprint} from './drawing.mjs';import {archiveDesignFingerprint} from './resources.mjs';
import {ownedViaEvidence} from './file-model-evidence.mjs';
const types=new Set(['LINE','VIA','POLY']);
export function extractNativeCopper(data,documentUuid,{native,document}={}){
 const rows=[];for(const [name,bytes]of Object.entries(unzipSync(Buffer.from(data,'base64'))))if(name.endsWith('.epru')){let doc;for(const {header:h,body,deleted}of parseNativeSource(strFromU8(bytes))){if(deleted)continue;if(h.type==='DOCHEAD')doc=body.uuid;else if(doc===documentUuid&&types.has(h.type))rows.push({documentUuid,type:h.type,id:h.id,body});}}
 rows.push(...ownedViaEvidence(data,native,document));
 if(rows.some(x=>!x.id)||new Set(rows.map(x=>x.id)).size!==rows.length)throw Error('NATIVE_COPPER_ID_AMBIGUOUS');rows.sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b)));return {documentUuid,rows,sha256:fingerprint(rows),complete:true};
}
export function widthProjectionProof(original,current,{storedBefore,storedAfter}={}){
 const valid=e=>e?.complete===true&&fingerprint(e.rows)===e.sha256;
 if(!valid(storedBefore)||!valid(storedAfter)||storedBefore.documentUuid!==storedAfter.documentUuid)return null;
 const a=storedBefore.rows.filter(x=>x.id===original.primitiveId),b=storedAfter.rows.filter(x=>x.id===current.primitiveId);if(a.length!==1||b.length!==1||!['LINE','POLY'].includes(a[0].type)||b[0].type!==a[0].type)return null;
 const width=a[0].body.width;if(!Number.isFinite(width)||width!==b[0].body.width||!Number.isFinite(original.lineWidth)||Math.abs(original.lineWidth-width)>.0001||current.lineWidth!==width)return null;
 if(original.primitiveId===current.primitiveId&&fingerprint(a[0])!==fingerprint(b[0]))return null;
 if(a[0].body.netName!==b[0].body.netName||a[0].body.layerId!==b[0].body.layerId||a[0].body.locked!==b[0].body.locked)return null;
 return {originalId:original.primitiveId,currentId:current.primitiveId,field:'lineWidth',beforeApi:original.lineWidth,afterApi:current.lineWidth,storedWidth:width,storedExact:true,existingSerializationBoundMil:.0001,method:'Exact source-bound native width and record content; only API width projection differs.'};
}
// Migration for an already verified live request whose earlier capture predates
// raw copper evidence. Exact old full-archive SHA is mandatory; never infer data.
export function reconcileEarlierCopper({data,documentUuid,beforeNative,afterNative,expectedArchive}){
 const files=unzipSync(Buffer.from(data,'base64')),before=new Set(beforeNative.objects.map(x=>x.primitiveId)),added=new Set(afterNative.objects.filter(x=>!before.has(x.primitiveId)).map(x=>x.primitiveId)),removed=[],placeholders=[];
 const project=omitPlaceholder=>{const copy={...files};for(const [name,bytes]of Object.entries(files))if(name.endsWith('.epru')){let doc;copy[name]=strToU8(strFromU8(bytes).split('\n').filter(line=>{if(!line.trim())return true;const i=line.indexOf('||'),h=JSON.parse(line.slice(0,i)),body=JSON.parse(line.slice(i+2).replace(/\|$/,''));if(h.type==='DOCHEAD')doc=body.uuid;if(doc!==documentUuid)return true;if(['LINE','VIA'].includes(h.type)&&added.has(h.id)){if(!omitPlaceholder)removed.push({type:h.type,id:h.id});return false;}if(h.type==='ELE_PLACEHOLDER'&&body.dataType==='LINE'&&body.max===1){if(!omitPlaceholder)placeholders.push(h.id);if(omitPlaceholder&&h.id===omitPlaceholder)return false;}return true;}).join('\n'));}return Buffer.from(zipSync(copy)).toString('base64');};
 let projected=project(null),digest=archiveDesignFingerprint(projected),placeholder=null;
 if(digest.sha256!==expectedArchive?.sha256){const matches=[];for(const id of placeholders){const source=project(id),d=archiveDesignFingerprint(source);if(d.sha256===expectedArchive?.sha256)matches.push({id,source,digest:d});}if(matches.length!==1)throw Error('FILE_OLD_COPPER_SOURCE_NOT_RECONCILED');projected=matches[0].source;digest=matches[0].digest;placeholder=matches[0].id;}
 if(digest.sha256!==expectedArchive?.sha256)throw Error('FILE_OLD_COPPER_SOURCE_NOT_RECONCILED');const evidence=extractNativeCopper(projected,documentUuid);if(evidence.rows.length!==before.size||evidence.rows.some(x=>!before.has(x.id)))throw Error('FILE_OLD_COPPER_COVERAGE');
 return {evidence,proof:{method:'Read-only source reconciliation; exact captured export-before full archive SHA, excluding only known added LINE/VIA and at most one uniquely proved new LINE placeholder',expectedSha256:expectedArchive.sha256,actualSha256:digest.sha256,removedAddedCopper:removed,omittedPlaceholder:placeholder,nativeOrSourceFileMutated:false}};
}
