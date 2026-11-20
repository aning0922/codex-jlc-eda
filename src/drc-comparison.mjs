import {fingerprint} from './drawing.mjs';
import {equivalentAngle} from './angles.mjs';
// DRC root and group `list` arrays are display collections. Every other array
// (object pairs, layer ids, coordinate/path vectors) remains ordered.
function canonical(value,collection=false,group=false){
 if(Array.isArray(value)){const items=value.map(v=>canonical(v,false,collection));return collection?items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):items;}
 if(value&&typeof value==='object'){
  const displayGroup=group&&typeof value.name==='string'&&Array.isArray(value.list)&&!('errorType' in value)&&!('explanation' in value);
  return Object.fromEntries(Object.keys(value).filter(k=>k!=='globalIndex').sort().map(k=>[k,canonical(value[k],displayGroup&&k==='list')]));
 }
 return value;
}
export function compareNativeDrc(expected,actual){
 if(!Array.isArray(expected)||!Array.isArray(actual))return {status:'unknown',issues:[{code:'PCB_DRC_COMPARISON_INCOMPLETE'}]};
 const expectedFingerprint=fingerprint(canonical(expected,true)),actualFingerprint=fingerprint(canonical(actual,true));
 return {status:expectedFingerprint===actualFingerprint?'matched':'mismatch',issues:expectedFingerprint===actualFingerprint?[]:[{code:'PCB_FRESH_DRC_RESULTS_DIFFER'}],expectedFingerprint,actualFingerprint,method:'all fields exact except volatile globalIndex; only root and group list order ignored; duplicate multiplicity and other arrays preserved'};
}

// PCB positions are stored to four decimal places in mil. A disconnected-pad
// marker uses 10 mil units and follows this same component translation on reopen.
export function compareStoredDrc(expected,actual,before,after,beforeNative,afterNative){
 const strict=compareNativeDrc(expected,actual);
 if(strict.status!=='mismatch')return strict;
 function pads(doc){
  const m=new Map();
  for(const c of doc?.components??[])for(const p of c.pins??[])m.set(p.id,m.has(p.id)?null:{c,p});
  return m;
 }
 function vias(native){
  const m=new Map();
  if(native?.status==='ok')for(const v of native.objects??[])if(v.kind==='Via')m.set(v.primitiveId,m.has(v.primitiveId)?null:v);
  return m;
 }
 const leaves=errors=>errors.flatMap(group=>Array.isArray(group?.list)?group.list.flatMap(net=>Array.isArray(net?.list)?net.list.filter(e=>e&&typeof e==='object'):[]):[]);
 const oldPads=pads(before),newPads=pads(after),oldVias=vias(beforeNative),newVias=vias(afterNative),oldLeaves=new Map(),copy=structuredClone(actual),roundedVias=[];
 for(const e of leaves(expected)){const id=e.explanation?.errData?.obj1;oldLeaves.set(id,oldLeaves.has(id)?null:e);}
 let translated=0,maxDeltaMil=0;
 for(const e of leaves(copy)){
  const a=e.explanation?.errData,id=a?.obj1,old=oldLeaves.get(id),b=old?.explanation?.errData,src=oldPads.get(id),dst=newPads.get(id);
  const from=oldVias.get(id),to=newVias.get(id);
  if(from&&to&&old?.errorType==='Connection Error'&&e.errorType===old.errorType&&a.errorType==='No Connection'&&b.errorType===a.errorType&&e.errorObjType==='Via'&&a.obj1Type==='Via'&&e.objs?.length===1&&e.objs[0]===id&&
     from.net&&from.net===e.net&&to.net===e.net&&from.viaType===0&&to.viaType===0&&from.diameter===to.diameter&&from.holeDiameter===to.holeDiameter&&from.primitiveLock===to.primitiveLock){
   const axes=['x','y'];
   if(axes.every(k=>Number.isFinite(e.pos?.[k])&&Number.isFinite(old.pos?.[k])&&e.pos[k]===a.position?.[k]&&old.pos[k]===b.position?.[k]&&Math.abs(old.pos[k]-from[k]/10)<1e-9&&Math.abs(e.pos[k]-to[k]/10)<1e-9&&Math.abs(to[k]-Math.round(from[k]*10000)/10000)<1e-9)&&axes.some(k=>e.pos[k]!==old.pos[k])){
    for(const k of axes)e.pos[k]=a.position[k]=old.pos[k];
    roundedVias.push(id);
   }
   continue;
  }
  if(!src||!dst||!b||a.errorType!=='No Connection'||b.errorType!==a.errorType||e.errorType!=='Connection Error'||old.errorType!==e.errorType||
     !e.net||src.p.net!==e.net||dst.p.net!==e.net||src.p.number!==dst.p.number||src.c.id!==dst.c.id||src.c.uniqueId!==dst.c.uniqueId||
     src.c.footprint?.uuid!==dst.c.footprint?.uuid||!equivalentAngle(src.c.rotation,dst.c.rotation)||src.c.layer!==dst.c.layer)continue;
  const axes=['x','y'];
  if(!axes.every(k=>{
   const delta=dst.c[k]-src.c[k],v=e.pos?.[k],w=old.pos?.[k];
   return Number.isFinite(delta)&&Math.abs(delta)<=.000051&&v===a.position?.[k]&&w===b.position?.[k]&&
     Math.abs(w-src.p[k]/10)<=.0051&&Math.abs(v-dst.p[k]/10)<=.0051&&Math.abs(v-w-delta/10)<1e-9;
  }))continue;
  if(axes.some(k=>e.pos[k]!==old.pos[k])){
   maxDeltaMil=Math.max(maxDeltaMil,...axes.map(k=>Math.abs(dst.c[k]-src.c[k])));
   for(const k of axes)e.pos[k]=a.position[k]=old.pos[k];translated++;
  }
 }
 if(!translated&&!roundedVias.length)return strict;
 const reconciled=compareNativeDrc(expected,copy);
 return reconciled.status==='matched'?{...reconciled,actualRawFingerprint:strict.actualFingerprint,translated,maxDeltaMil,roundedVias,method:'Disconnected-marker coordinates bound to their own stored component or via; all other fields use strict comparison'}:strict;
}
export {compareStoredDrc as comparePlacedPadDrc};
