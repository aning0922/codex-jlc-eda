import {fingerprint} from './drawing.mjs';import {compareRoutingCheckpoint} from './p3.mjs';
const same=(a,b)=>fingerprint(a)===fingerprint(b),near=(a,b)=>Math.abs(a-b)<=.0001;
export function compareRepairKeep(before,after,{storedBefore,storedAfter,splitNets=[]}={}){
 const issues=[],mapping=[],used=new Set(),valid=e=>e?.complete&&fingerprint(e.rows)===e.sha256&&new Set(e.rows.map(x=>x.id)).size===e.rows.length;
 if(storedBefore&&(!valid(storedBefore)||!valid(storedAfter)||storedBefore.documentUuid!==storedAfter.documentUuid))return {status:'mismatch',issues:[{code:'REPAIR_RAW_EVIDENCE_INCOMPLETE'}],mapping};
 for(const x of before.objects){
  const original=storedBefore?.rows.filter(r=>r.id===x.primitiveId),found=after.objects.filter(y=>y.primitiveId===x.primitiveId);
  if(storedBefore&&original.length!==1){issues.push({code:'REPAIR_RAW_SOURCE_MISSING',id:x.primitiveId});continue;}
  if(found.length){const current=storedAfter?.rows.filter(r=>r.id===x.primitiveId);if(found.length!==1||compareRoutingCheckpoint({...before,objects:[x]},{...after,objects:found},{compareRules:false}).status!=='matched'||storedBefore&&(current.length!==1||!same(original[0],current[0]))){issues.push({code:'REPAIR_ORIGINAL_CHANGED',id:x.primitiveId});continue;}
   if(x.kind==='Line'){
    const dx=x.endX-x.startX,dy=x.endY-x.startY,len=Math.hypot(dx,dy),pos=(px,py)=>((px-x.startX)*dx+(py-x.startY)*dy)/(len*len),collinear=(px,py)=>Math.abs((px-x.startX)*dy-(py-x.startY)*dx)/len<=.0001;
    const duplicates=after.objects.filter(y=>y.kind==='Line'&&y.net===x.net&&y.layer===x.layer&&!before.objects.some(b=>b.primitiveId===y.primitiveId)&&collinear(y.startX,y.startY)&&collinear(y.endX,y.endY)&&Math.min(pos(y.startX,y.startY),pos(y.endX,y.endY))<1-.0001/len&&Math.max(pos(y.startX,y.startY),pos(y.endX,y.endY))>.0001/len);
    if(duplicates.length){issues.push({code:'REPAIR_DUPLICATE_SOURCE_COVERAGE',id:x.primitiveId,newIds:duplicates.map(y=>y.primitiveId)});continue;}
   }
   mapping.push({originalId:x.primitiveId,newIds:[x.primitiveId],nativeIdKept:true});used.add(x.primitiveId);continue;}
  if(x.kind!=='Line'||!splitNets.includes(x.net)){issues.push({code:'REPAIR_ORIGINAL_MISSING',id:x.primitiveId});continue;}
  const dx=x.endX-x.startX,dy=x.endY-x.startY,len=Math.hypot(dx,dy),pos=(px,py)=>((px-x.startX)*dx+(py-x.startY)*dy)/(len*len),distance=(px,py)=>Math.abs((px-x.startX)*dy-(py-x.startY)*dx)/len;
  if(!(len>0)){issues.push({code:'REPAIR_SOURCE_LINE_INVALID',id:x.primitiveId});continue;}
  const parts=after.objects.filter(y=>y.kind==='Line'&&y.net===x.net&&y.layer===x.layer&&near(y.lineWidth,x.lineWidth)&&y.primitiveLock===x.primitiveLock&&distance(y.startX,y.startY)<=.0001&&distance(y.endX,y.endY)<=.0001).map(y=>({y,lo:Math.min(pos(y.startX,y.startY),pos(y.endX,y.endY)),hi:Math.max(pos(y.startX,y.startY),pos(y.endX,y.endY))})).filter(q=>q.hi>0&&q.lo<1).sort((a,b)=>a.lo-b.lo);
  let ok=parts.length>=2,end=0;const tol=.0001/len;
  const strip=b=>Object.fromEntries(Object.entries(b).filter(([k])=>!['startX','startY','endX','endY'].includes(k)));
  for(const q of parts){ok&&=!used.has(q.y.primitiveId)&&q.lo>=-tol&&q.hi<=1+tol&&q.hi>q.lo&&Math.abs(q.lo-end)<=tol;end=q.hi;if(storedBefore){const rows=storedAfter.rows.filter(r=>r.id===q.y.primitiveId&&r.type==='LINE');ok&&=rows.length===1&&original[0].type==='LINE'&&same(strip(original[0].body),strip(rows[0].body));}}
  ok&&=near(end*len,len);if(!ok){issues.push({code:'REPAIR_EXACT_COLLINEAR_SPLIT_REJECTED',id:x.primitiveId,candidates:parts.map(q=>q.y.primitiveId)});continue;}
  parts.forEach(q=>used.add(q.y.primitiveId));mapping.push({originalId:x.primitiveId,newIds:parts.map(q=>q.y.primitiveId),nativeIdKept:false,physicalContentKept:true,sourceLockPreserved:x.primitiveLock});
 }
 if(new Set(after.objects.map(x=>x.primitiveId)).size!==after.objects.length||before.layers!==after.layers)issues.push({code:'REPAIR_DUPLICATE_IDS_OR_LAYERS'});
 return {status:issues.length?'mismatch':'matched',issues,mapping,nativeIdsPreserved:mapping.length===before.objects.length&&mapping.every(x=>x.nativeIdKept),physicalContentPreserved:issues.length===0,geometryBoundMil:.0001,qualification:'Only explicit target-net native Line splitting; complete collinear coverage, width/net/layer/lock and all other stored LINE fields unchanged. No original Via split, no non-target changes.'};
}
