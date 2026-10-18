import {nativeModelRecords} from './file-model-evidence.mjs';
import {fingerprint} from './drawing.mjs';
import {allocatorChanges} from './incremental-allocators.mjs';
const key=r=>r.type+'/'+r.id,near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.0001;
export function compareRouteArchives(before,after,{documentUuid,added}={}){
 const a=nativeModelRecords(before.pcbData),b=nativeModelRecords(after.pcbData),issues=[],old=a.get(documentUuid),now=b.get(documentUuid);
 if(fingerprint(before.schematic)!==fingerprint(after.schematic))issues.push({code:'ROUTE_SCHEMATIC_CHANGED'});
 if(!old||!now)return {status:'mismatch',issues:[...issues,{code:'ROUTE_ARCHIVE_TARGET_MISSING'}]};
 const asRows=doc=>doc.rows.map(r=>({header:{type:r.type,id:r.id},body:r.body}));
 const allocator=allocatorChanges(asRows(old),asRows(now),added.length),allocatorIds=new Set(allocator.matched?allocator.accepted.map(r=>r.id):[]);
 // The installed official EPcbDataType schema defines these as conversion-only
 // placeholders, explicitly skipped by the 3.0 reader, not geometry counters.
 // Keep prior records exact; bound only new sequential scalar LINE placeholders
 // by the independently validated new-copper count. Never relax older gates.
 const conversionPlaceholders=now.rows.filter(r=>r.type==='ELE_PLACEHOLDER'&&!old.rows.some(o=>key(o)===key(r))).sort((a,b)=>Number(a.id.slice(11))-Number(b.id.slice(11)));
 let maxPlaceholder=Math.max(0,...old.rows.filter(r=>r.type==='ELE_PLACEHOLDER').map(r=>Number(String(r.id).replace(/^placeholder/,''))));
 const validConversion=conversionPlaceholders.every(r=>r.id==='placeholder'+(++maxPlaceholder)&&Object.keys(r.body).length===2&&r.body.dataType==='LINE'&&Number.isInteger(r.body.max)&&r.body.max>0)&&conversionPlaceholders.reduce((sum,r)=>sum+r.body.max,0)<=added.length;
 const conversionIds=new Set(validConversion?conversionPlaceholders.map(r=>r.id):[]);
 for(const [uuid,d] of a){const n=b.get(uuid);if(!n){issues.push({code:'ROUTE_SOURCE_DOCUMENT_MISSING',uuid});continue;}
  if(uuid!==documentUuid){if(fingerprint(d)!==fingerprint(n))issues.push({code:'ROUTE_MODEL_CHANGED',uuid});continue;}
  if(fingerprint(d.tombstones)!==fingerprint(n.tombstones))issues.push({code:'ROUTE_DELETION_CHANGED'});
  for(const row of d.rows){const current=n.rows.filter(x=>key(x)===key(row));if(current.length!==1||!allocatorIds.has(row.id)&&fingerprint(row)!==fingerprint(current[0]))issues.push({code:'ROUTE_ORIGINAL_RECORD_CHANGED',key:key(row)});}
 }
 const captured=[];
 for(const row of now.rows)if(!old.rows.some(x=>key(x)===key(row))){
  if(row.type==='ELE_PLACEHOLDER'&&(allocatorIds.has(row.id)||conversionIds.has(row.id)))continue;
  const object=added.find(x=>x.primitiveId===row.id),s=row.body;let valid=false;
  if(row.type==='LINE'&&object?.kind==='Line')valid=s.netName===object.net&&s.layerId===object.layer&&s.locked===object.primitiveLock&&[['startX','startX'],['startY','startY'],['endX','endX'],['endY','endY'],['width','lineWidth']].every(([k,v])=>near(s[k],object[v]));
  if(row.type==='VIA'&&object?.kind==='Via')valid=s.netName===object.net&&s.viaType==='NORMAL'&&object.viaType===0&&s.locked===object.primitiveLock&&[['centerX','x'],['centerY','y'],['viaDiameter','diameter'],['holeDiameter','holeDiameter']].every(([k,v])=>near(s[k],object[v]));
  if(!valid)issues.push({code:'ROUTE_UNEXPECTED_NATIVE_RECORD',record:row});else captured.push(row);
 }
 for(const x of added)if(!captured.some(r=>r.id===x.primitiveId))issues.push({code:'ROUTE_API_OBJECT_NOT_IN_ARCHIVE',id:x.primitiveId});
 for(const uuid of b.keys())if(!a.has(uuid))issues.push({code:'ROUTE_UNEXPECTED_DOCUMENT',uuid});
 return {status:issues.length?'mismatch':'matched',issues,addedSourceRecords:captured,allocator:allocator.matched?allocator:null,conversionPlaceholders:validConversion?conversionPlaceholders:[],coverage:'All native records, model documents, original copper IDs and deletion identities; new LINE/VIA geometry bound to native API readback and declared routing scope; bounded scalar conversion placeholders reported separately'};
}
