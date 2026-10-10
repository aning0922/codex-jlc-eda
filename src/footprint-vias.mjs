import{parseNativeSource}from'./native-records.mjs';
import {unzipSync,strFromU8} from 'fflate';
import {createHash} from 'node:crypto';

const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.0001;
const sha=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');

// A prefix is never sufficient ownership evidence. Match an exported native
// footprint VIA record, exact composite ID, current instance transformation,
// diameter, hole, type and lock. Unknown model formats fail closed.
export function proveFootprintVias(native){
  if(native.status!=='ok'||!native.footprintViaData)return native;
  const {modelsBase64,components}=native.footprintViaData,{footprintViaData,...result}=native;
  const issues=[],models=new Map();
  try{
    for(const [file,bytes] of Object.entries(unzipSync(Buffer.from(modelsBase64,'base64')))){
      if(!file.endsWith('.epru'))continue;let model;
      for(const {header:head,body,deleted}of parseNativeSource(strFromU8(bytes))){if(deleted)continue;
        if(head.type==='DOCHEAD'){
          model=body.docType==='FOOTPRINT'?{uuid:body.uuid,vias:[],origin:null,source:null}:null;
          if(model){if(models.has(model.uuid))throw Error('Duplicate footprint model');models.set(model.uuid,model);}
        }else if(model&&head.type==='CANVAS')model.origin={x:body.originX,y:body.originY};
        else if(model&&head.type==='META')model.source=body.source;
        else if(model&&head.type==='VIA')model.vias.push({id:head.id,...body});
      }
    }
    if(!Array.isArray(components)||!Array.isArray(result.objects))throw Error('Missing instance inventory');
    const expected=[];
    for(const c of components){
      const model=models.get(c.footprint?.uuid);
      if(!model)throw Error('Instance footprint model missing');
      if(!model.vias.length)continue;
      // Nonzero origins and bottom-side model mirroring need separate evidence.
      if(c.layer!==1||model.origin?.x!==0||model.origin?.y!==0||!model.source||![c.x,c.y,c.rotation].every(Number.isFinite))throw Error('Footprint VIA transform unsupported');
      const theta=c.rotation*Math.PI/180,co=Math.cos(theta),si=Math.sin(theta);
      for(const v of model.vias){
        if(v.viaType!=='NORMAL'||typeof v.id!=='string'||![v.centerX,v.centerY,v.viaDiameter,v.holeDiameter].every(Number.isFinite)||v.holeDiameter<=0||v.viaDiameter<=v.holeDiameter)throw Error('Footprint VIA geometry unsupported');
        expected.push({primitiveId:c.id+v.id,x:c.x+v.centerX*co-v.centerY*si,y:c.y+v.centerX*si+v.centerY*co,diameter:v.viaDiameter,holeDiameter:v.holeDiameter,viaType:0,primitiveLock:v.locked,componentOwnership:{componentId:c.id,uniqueId:c.uniqueId,footprintUuid:model.uuid,source:model.source,sourceViaId:v.id,modelViaFingerprint:sha(v)}});
      }
    }
    const owned=new Map();
    for(const e of expected){
      const found=result.objects.filter(x=>x.primitiveId===e.primitiveId);
      if(found.length!==1||found[0].kind!=='Via'||!['x','y','diameter','holeDiameter'].every(k=>near(e[k],found[0][k]))||found[0].viaType!==e.viaType||found[0].primitiveLock!==e.primitiveLock||owned.has(e.primitiveId))issues.push({code:'FOOTPRINT_VIA_ID_OR_GEOMETRY_MISMATCH',expected:e,actual:found});
      else owned.set(e.primitiveId,e.componentOwnership);
    }
    result.objects=result.objects.map(x=>owned.has(x.primitiveId)?{...x,componentOwnership:owned.get(x.primitiveId)}:x);
    result.footprintVias={status:issues.length?'mismatch':'matched',expectedCount:expected.length,matchedCount:owned.size,issues,coverage:'native model record plus exact instance transform; top-side zero-origin footprints only'};
    if(issues.length){result.status='unknown';result.code='FOOTPRINT_VIA_OWNERSHIP_UNVERIFIED';}
  }catch(e){result.status='unknown';result.code='FOOTPRINT_VIA_MODEL_UNVERIFIED';result.footprintVias={status:'unknown',issues:[{message:e.message}]};}
  return result;
}

export function isOwnedFootprintVia(object){
  const o=object.componentOwnership;
  return object.kind==='Via'&&!!o?.componentId&&!!o.uniqueId&&!!o.footprintUuid&&!!o.source&&!!o.sourceViaId&&!!o.modelViaFingerprint&&object.primitiveId===o.componentId+o.sourceViaId;
}

export function compareMovedFootprintVias(before,beforeComponents,plan,after){
  const issues=[];
  const unexpected=after.filter(x=>!isOwnedFootprintVia(x)&&x.layer!==11);
  if(unexpected.length)issues.push({code:'LAYOUT_UNEXPECTED_ARTWORK',objects:unexpected});
  const owned=before.filter(isOwnedFootprintVia),current=after.filter(isOwnedFootprintVia);
  if(owned.length!==current.length)issues.push({code:'LAYOUT_FOOTPRINT_VIA_COUNT_CHANGED'});
  for(const v of owned){
    const owner=beforeComponents.find(c=>c.id===v.componentOwnership.componentId&&c.uniqueId===v.componentOwnership.uniqueId),pose=plan.poses.find(c=>c.id===owner?.id),found=after.filter(x=>x.primitiveId===v.primitiveId);
    if(!owner||!pose||found.length!==1){issues.push({code:'LAYOUT_FOOTPRINT_VIA_OWNER_OR_ID_CHANGED',id:v.primitiveId});continue;}
    const theta=(pose.rotation-owner.rotation)*Math.PI/180,dx=v.x-owner.x,dy=v.y-owner.y;
    const expected={...v,x:pose.x+dx*Math.cos(theta)-dy*Math.sin(theta),y:pose.y+dx*Math.sin(theta)+dy*Math.cos(theta)},actual=found[0];
    if(Object.keys(expected).some(k=>['x','y','diameter','holeDiameter'].includes(k)?!near(expected[k],actual[k]):JSON.stringify(expected[k])!==JSON.stringify(actual[k])))issues.push({code:'LAYOUT_FOOTPRINT_VIA_CHANGED',id:v.primitiveId,expected,actual});
  }
  return {status:issues.length?'mismatch':'matched',issues,count:owned.length};
}
