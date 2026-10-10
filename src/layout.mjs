import {z} from 'zod';
import {equivalentAngle} from './angles.mjs';
export const unit=z.enum(['mm','mil']);
const n=z.number().finite().min(-1e5).max(1e5),positive=z.number().finite().positive().max(1e5);
export const layoutSchema=z.object({unit,board:z.object({x:n,y:n,width:positive,height:positive,layers:z.literal(2),outlineWidth:positive}).strict(),edgeClearance:z.number().nonnegative().finite(),componentClearance:z.number().nonnegative().finite(),components:z.array(z.object({uniqueId:z.string().min(1),x:n,y:n,rotation:z.number().finite().min(0).max(359.999),layer:z.union([z.literal(1),z.literal(2)]),fixed:z.boolean(),group:z.string().min(1).max(100)}).strict()).min(1).max(30),distanceConstraints:z.array(z.object({from:z.object({uniqueId:z.string(),pin:z.string()}).strict(),to:z.object({uniqueId:z.string(),pin:z.string()}).strict(),maximum:positive,reason:z.string().min(1)}).strict()).default([])}).strict();
export const toMil=(value,u)=>u==='mm'?value/0.0254:value;
// Input y follows native PCB +Y direction. Board y is the top edge; height extends -Y.
export function planLayout(input,doc){
 const p=layoutSchema.parse(input),issues=[],seen=new Set(),poses=[];
 if(doc.status!=='ok'||doc.truncated!==false||doc.components.length!==doc.counts?.components)issues.push({code:'LAYOUT_GEOMETRY_INCOMPLETE'});
 const b=Object.fromEntries(Object.entries(p.board).map(([k,v])=>[k,['x','y','width','height','outlineWidth'].includes(k)?toMil(v,p.unit):v]));
 for(const c of p.components){
  if(seen.has(c.uniqueId)){issues.push({code:'LAYOUT_DUPLICATE_ID',uniqueId:c.uniqueId});continue;}seen.add(c.uniqueId);
  const found=doc.components.filter(x=>x.uniqueId===c.uniqueId);if(found.length!==1){issues.push({code:'LAYOUT_ID_AMBIGUOUS',uniqueId:c.uniqueId});continue;}
  const old=found[0],x=toMil(c.x,p.unit),y=toMil(c.y,p.unit);
  if(c.layer!==old.layer){issues.push({code:'LAYOUT_SIDE_CHANGE_UNSUPPORTED',uniqueId:c.uniqueId});continue;}
  const bounds=old.primitiveBounds;if(!bounds||!Object.values(bounds).every(Number.isFinite)){issues.push({code:'LAYOUT_PRIMITIVE_BOUNDS_MISSING',uniqueId:c.uniqueId});continue;}
  const theta=(c.rotation-old.rotation)*Math.PI/180;
  const transform=(px,py)=>({x:x+(px-old.x)*Math.cos(theta)-(py-old.y)*Math.sin(theta),y:y+(px-old.x)*Math.sin(theta)+(py-old.y)*Math.cos(theta)});
  const corners=[[bounds.minX,bounds.minY],[bounds.minX,bounds.maxY],[bounds.maxX,bounds.minY],[bounds.maxX,bounds.maxY]].map(q=>transform(...q));
  const projectedBounds={minX:Math.min(...corners.map(q=>q.x)),maxX:Math.max(...corners.map(q=>q.x)),minY:Math.min(...corners.map(q=>q.y)),maxY:Math.max(...corners.map(q=>q.y))};
  const margin=toMil(p.edgeClearance,p.unit);if(projectedBounds.minX<b.x+margin||projectedBounds.maxX>b.x+b.width-margin||projectedBounds.minY<b.y-b.height+margin||projectedBounds.maxY>b.y-margin)issues.push({code:'LAYOUT_OUTSIDE_BOARD_MARGIN',uniqueId:c.uniqueId,projectedBounds});
  poses.push({...c,x,y,id:old.id,projectedBounds,pins:(old.pins??[]).map(pin=>({...pin,...transform(pin.x,pin.y)}))});
 }
 if(doc.components.some(c=>!seen.has(c.uniqueId)))issues.push({code:'LAYOUT_ALL_COMPONENTS_REQUIRED'});
 const gap=toMil(p.componentClearance,p.unit);
 for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++){const a=poses[i],c=poses[j],u=a.projectedBounds,v=c.projectedBounds;if(a.layer===c.layer&&u.minX<v.maxX+gap&&u.maxX>v.minX-gap&&u.minY<v.maxY+gap&&u.maxY>v.minY-gap)issues.push({code:'LAYOUT_BOUNDS_OVERLAP_OR_CLEARANCE',ids:[a.uniqueId,c.uniqueId]});}
 for(const d of p.distanceConstraints){const a=poses.find(c=>c.uniqueId===d.from.uniqueId)?.pins.filter(q=>q.number===d.from.pin),c=poses.find(c=>c.uniqueId===d.to.uniqueId)?.pins.filter(q=>q.number===d.to.pin);if(a?.length!==1||c?.length!==1)issues.push({code:'LAYOUT_DISTANCE_PIN_AMBIGUOUS',constraint:d});else if(Math.hypot(a[0].x-c[0].x,a[0].y-c[0].y)>toMil(d.maximum,p.unit))issues.push({code:'LAYOUT_DISTANCE_EXCEEDED',constraint:d});}
 return {status:issues.length?'failed':'ok',issues,input:p,board:b,poses,geometryMeaning:'native complete primitive BBox projected conservatively; pad geometry read from actual instances; mechanical/3D envelope unverified',coordinates:'mil; native +Y; rectangle extends -Y'};
}
export function checkLayout(plan,doc){
 const issues=[];
 if(doc.status!=='ok'||doc.truncated!==false||!Array.isArray(doc.components)||doc.counts?.components!==plan.poses.length)return {status:'unknown',issues:[{code:'LAYOUT_READBACK_INCOMPLETE'}]};
 for(const e of plan.poses){const all=doc.components.filter(c=>c.uniqueId===e.uniqueId),a=all[0];if(all.length!==1){issues.push({code:'LAYOUT_INSTANCE_MISSING_OR_DUPLICATED',uniqueId:e.uniqueId});continue;}for(const k of ['id','x','y','rotation','layer'])if(k==='rotation'?!equivalentAngle(e[k],a[k]):['x','y'].includes(k)?!Number.isFinite(a[k])||Math.abs(e[k]-a[k])>0.0001:e[k]!==a[k])issues.push({code:'LAYOUT_POSE_MISMATCH',uniqueId:e.uniqueId,key:k,expected:e[k],actual:a[k]});}
 for(const e of plan.poses){const a=doc.components.find(c=>c.uniqueId===e.uniqueId);if(a?.primitiveLock!==e.fixed)issues.push({code:'LAYOUT_LOCK_MISMATCH',uniqueId:e.uniqueId,expected:e.fixed,actual:a?.primitiveLock});}
 const actual=planLayout(plan.input,doc);issues.push(...actual.issues);
 return {status:issues.length?'mismatch':'matched',issues,actual:doc.components.map(c=>({uniqueId:c.uniqueId,designator:c.designator,id:c.id,x:c.x,y:c.y,rotation:c.rotation,layer:c.layer,primitiveBounds:c.primitiveBounds}))};
}
