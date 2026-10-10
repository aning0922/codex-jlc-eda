import {fingerprint} from './drawing.mjs';
import {widthProjectionProof} from './native-copper-evidence.mjs';
const near=(x,y)=>Number.isFinite(x)&&Number.isFinite(y)&&Math.abs(x-y)<=0.0001;
export function compareFilePreservation(before,after,{policy,storedBefore,storedAfter}={}){
 if(policy!=='strict_collinear_coverage')return {status:'mismatch',issues:[{code:'FILE_KEEP_POLICY_REQUIRED'}],mapping:[]};
 const issues=[],mapping=[],widthProjections=[],used=new Set(),objects=after.objects??[];
 const evidenceProvided=!!storedBefore||!!storedAfter,validEvidence=e=>e?.complete===true&&fingerprint(e.rows)===e.sha256&&new Set(e.rows.map(x=>x.id)).size===e.rows.length;
 if(evidenceProvided&&(!validEvidence(storedBefore)||!validEvidence(storedAfter)||storedBefore.documentUuid!==storedAfter.documentUuid))return {status:'mismatch',issues:[{code:'FILE_STORED_COPPER_EVIDENCE_INCOMPLETE'}],mapping:[],widthProjections:[]};
 for(const x of before.objects??[]){const found=objects.filter(y=>y.primitiveId===x.primitiveId);
  if(evidenceProvided){const original=storedBefore.rows.filter(r=>r.id===x.primitiveId),current=storedAfter.rows.filter(r=>r.id===x.primitiveId);if(original.length!==1||found.length&&current.length!==1||found.length&&fingerprint(original[0])!==fingerprint(current[0])){issues.push({code:'FILE_ORIGINAL_STORED_RECORD_CHANGED',id:x.primitiveId});continue;}}
  if(found.length){let exact=found.length===1&&fingerprint(found[0])===fingerprint(x);if(!exact&&found.length===1){const proof=widthProjectionProof(x,found[0],{storedBefore,storedAfter});if(proof&&fingerprint({...x,lineWidth:found[0].lineWidth})===fingerprint(found[0])){exact=true;widthProjections.push(proof);}}if(!exact)issues.push({code:'FILE_ORIGINAL_ID_CHANGED',id:x.primitiveId});else{if(x.kind==='Line'){const dx=x.endX-x.startX,dy=x.endY-x.startY,len=Math.hypot(dx,dy),pos=(px,py)=>((px-x.startX)*dx+(py-x.startY)*dy)/(len*len),collinear=(px,py)=>Math.abs((px-x.startX)*dy-(py-x.startY)*dx)/len<=.0001;const overlap=objects.filter(y=>y.kind==='Line'&&y.primitiveId!==x.primitiveId&&!before.objects.some(b=>b.primitiveId===y.primitiveId)&&collinear(y.startX,y.startY)&&collinear(y.endX,y.endY)&&Math.min(pos(y.startX,y.startY),pos(y.endX,y.endY))<1&&Math.max(pos(y.startX,y.startY),pos(y.endX,y.endY))>0);if(overlap.length)issues.push({code:'FILE_ORIGINAL_COVERAGE_DUPLICATED',id:x.primitiveId,newIds:overlap.map(y=>y.primitiveId)});}mapping.push({originalId:x.primitiveId,newIds:[x.primitiveId],nativeIdKept:true,physicalContentKept:true});used.add(x.primitiveId);}continue;}
  if(x.kind!=='Line'||x.primitiveLock!==true){issues.push({code:'FILE_ORIGINAL_MISSING',id:x.primitiveId});continue;}
  const dx=x.endX-x.startX,dy=x.endY-x.startY,len=Math.hypot(dx,dy);if(!Number.isFinite(len)||len===0){issues.push({code:'FILE_ORIGINAL_LINE_INVALID',id:x.primitiveId});continue;}
  const distance=(px,py)=>Math.abs((px-x.startX)*dy-(py-x.startY)*dx)/len,parameter=(px,py)=>((px-x.startX)*dx+(py-x.startY)*dy)/(len*len);
  const parts=objects.filter(y=>y.kind==='Line'&&distance(y.startX,y.startY)<=0.0001&&distance(y.endX,y.endY)<=0.0001).map(y=>({object:y,lo:Math.min(parameter(y.startX,y.startY),parameter(y.endX,y.endY)),hi:Math.max(parameter(y.startX,y.startY),parameter(y.endX,y.endY))})).filter(y=>y.hi>0&&y.lo<1).sort((a,b)=>a.lo-b.lo);
  const tol=.0001/len;let valid=parts.length>=2,end=0;for(const q of parts){const y=q.object;const widthProof=y.lineWidth===x.lineWidth?null:widthProjectionProof(x,y,{storedBefore,storedAfter});if(widthProof)widthProjections.push(widthProof);valid&&=y.net===x.net&&y.layer===x.layer&&(y.lineWidth===x.lineWidth||!!widthProof)&&y.primitiveLock===x.primitiveLock&&!used.has(y.primitiveId)&&q.lo>=-tol&&q.hi<=1+tol&&q.hi>q.lo&&Math.abs(q.lo-end)<=tol;end=q.hi;}
  valid&&=near(end*len,len);if(!valid){issues.push({code:'FILE_COLLINEAR_COVERAGE_REJECTED',id:x.primitiveId,candidates:parts.map(q=>q.object.primitiveId)});continue;}
  parts.forEach(q=>used.add(q.object.primitiveId));mapping.push({originalId:x.primitiveId,newIds:parts.map(q=>q.object.primitiveId),nativeIdKept:false,physicalContentKept:true,oneToMany:true});
 }
 if(before.layers!==after.layers)issues.push({code:'FILE_LAYERS_CHANGED'});
 const ids=objects.map(x=>x.primitiveId);if(new Set(ids).size!==ids.length)issues.push({code:'FILE_DUPLICATE_NATIVE_ID'});
 return {status:issues.length?'mismatch':'matched',issues,mapping,widthProjections,nativeIdsPreserved:mapping.length===(before.objects??[]).length&&mapping.every(x=>x.nativeIdKept),physicalContentPreserved:issues.length===0,policy};
}
