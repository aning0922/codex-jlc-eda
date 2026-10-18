import {nativeModelRecords} from './file-model-evidence.mjs';
import {fingerprint,drawingScript} from './drawing.mjs';
import {pcbScript} from './pcb.mjs';
import {scripts} from './native-scripts.mjs';
import {archiveDesignFingerprint} from './resources.mjs';
import {equivalentAngle} from './angles.mjs';
export async function capturePlacementArchives(a,p){
 const schFocus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'}));
 if(schFocus.status!=='ok')throw Object.assign(Error('PLACEMENT_SCH_FOCUS_UNCERTAIN'),{code:'PLACEMENT_SCH_FOCUS_UNCERTAIN',status:'unknown'});
 const sch=await a.invoke(p.sessionId,drawingScript({...p,operation:'archive'}));
 const pcbFocus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));
 const pcb=pcbFocus.status==='ok'?await a.invoke(p.sessionId,pcbScript({...p,operation:'archive'})):pcbFocus;
 if(sch.status!=='ok'||pcb.status!=='ok')throw Object.assign(Error('PLACEMENT_ARCHIVE_UNAVAILABLE'),{code:'PLACEMENT_ARCHIVE_UNAVAILABLE',status:'unknown'});
 return {schematic:archiveDesignFingerprint(sch.data),pcbData:pcb.data,pcb:archiveDesignFingerprint(pcb.data)};
}
const key=r=>r.type+'/'+r.id,without=(o,keys)=>Object.fromEntries(Object.entries(o).filter(([k])=>!keys.includes(k)));
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.0001;
// Native component modify may reorder its attrs dictionary; keys/values remain
// exact, array order remains meaningful, and no field is dropped.
const sameValue=(a,b)=>a===b||!!a&&!!b&&typeof a==='object'&&typeof b==='object'&&Array.isArray(a)===Array.isArray(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&sameValue(a[k],b[k]));
export function comparePlacementArchives(before,after,{documentUuid,beforeDocument,afterDocument,strategy='manual',outlineId}={}){
 const issues=[],edits=[],a=nativeModelRecords(before.pcbData),b=nativeModelRecords(after.pcbData);
 if(fingerprint(before.schematic)!==fingerprint(after.schematic))issues.push({code:'PLACEMENT_SCHEMATIC_CHANGED'});
 const ids=new Map(beforeDocument.components.map(c=>[c.id,c]));
 for(const [uuid,old] of a){const now=b.get(uuid);if(!now){issues.push({code:'PLACEMENT_DOCUMENT_MISSING',uuid});continue;}
  if(fingerprint(old.tombstones)!==fingerprint(now.tombstones))issues.push({code:'PLACEMENT_DELETIONS_CHANGED',uuid});
  if(uuid!==documentUuid){if(fingerprint(old)!==fingerprint(now))issues.push({code:'PLACEMENT_MODEL_CHANGED',uuid});continue;}
  const rows=new Map(now.rows.map(r=>[key(r),r]));if(rows.size!==now.rows.length)issues.push({code:'PLACEMENT_DUPLICATE_RECORD'});
  for(const r of old.rows){const n=rows.get(key(r));if(!n){issues.push({code:'PLACEMENT_RECORD_MISSING',key:key(r)});continue;}if(fingerprint(r)===fingerprint(n))continue;
   let allowed=false;
   if(r.type==='COMPONENT'&&ids.has(r.id)){
    const previous=ids.get(r.id),current=afterDocument.components.find(c=>c.id===r.id&&c.uniqueId===previous.uniqueId);
    allowed=!!current&&sameValue(without(r.body,['x','y','angle','locked']),without(n.body,['x','y','angle','locked']))&&near(n.body.x,current.x)&&near(n.body.y,current.y)&&equivalentAngle(n.body.angle,current.rotation)&&n.body.locked===current.primitiveLock;
    if(strategy==='auto_candidate'&&(previous.primitiveLock!==current?.primitiveLock||previous.primitiveLock&&(!near(previous.x,current.x)||!near(previous.y,current.y)||!equivalentAngle(previous.rotation,current.rotation))))allowed=false;
   }
   if(r.type==='ATTR'&&ids.has(r.body.parentId)){
    const fields=['x','y','angle','align'];
    allowed=sameValue(without(r.body,fields),without(n.body,fields))&&['x','y'].every(k=>r.body[k]===n.body[k]||Number.isFinite(n.body[k]));
   }
   if(!allowed)issues.push({code:'PLACEMENT_NON_TARGET_CHANGED',key:key(r),before:r.body,after:n.body});else edits.push({type:r.type,id:r.id,before:r.body,after:n.body});
  }
  for(const r of now.rows)if(!old.rows.some(o=>key(o)===key(r))){if(!(outlineId&&r.type==='POLY'&&r.id===outlineId&&r.body.layerId===11))issues.push({code:'PLACEMENT_UNEXPECTED_NEW_RECORD',record:r});}
 }
 for(const uuid of b.keys())if(!a.has(uuid))issues.push({code:'PLACEMENT_UNEXPECTED_NEW_DOCUMENT',uuid});
 return {status:issues.length?'mismatch':'matched',issues,edits,modelAndRuleCoverage:'All records and deletion identities; only declared component poses/locks and attached attribute placement may change; optional single native outline creation',schematicPreserved:fingerprint(before.schematic)===fingerprint(after.schematic)};
}
