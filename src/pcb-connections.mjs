import {z} from 'zod';
import {toMil} from './layout.mjs';
import {criticalPrimitives} from './pcb-validation.mjs';
import {parseBoardPath,pointInBoardPath} from './board-geometry.mjs';
import {provenPlanes,surfaceDistance,surfaceTolerance} from './copper-surface.mjs';
import {distanceSegment} from './manufacturing-geometry.mjs';

export function connectionsSchema(path,terminal){
 const point=z.array(z.number().finite()).length(2),positive=z.number().finite().positive();
 const fanout=z.object({net:z.string().min(1),from:terminal,layer:z.union([z.literal(1),z.literal(2)]),width:positive,waypoints:z.array(point).max(12).default([]),at:point,plane:z.string().min(1),via:z.object({diameter:positive,holeDiameter:positive}).strict()}).strict();
 return z.object({paths:z.array(path).max(32).default([]),fanouts:z.array(fanout).max(32).default([])}).strict().refine(b=>b.paths.length+b.fanouts.length>0&&b.paths.length+b.fanouts.length<=32,'Supply between one and 32 connections.');
}
const fail=code=>{throw Error(code);};
function endpoint(doc,e,net,layer){
 const parts=doc.components.filter(c=>c.uniqueId===e.uniqueId),pads=parts.length===1?parts[0].pins.filter(p=>p.number===e.pin):[];
 if(pads.length!==1||pads[0].net!==net||!(pads[0].layer===layer||pads[0].layer===12&&pads[0].metallization===true))fail('CONNECTION_PAD_UNVERIFIED');
 return [pads[0].x,pads[0].y];
}
export function connectionPrimitives(batch,doc,unit,native){
 const result=[],point=values=>values.map(v=>toMil(v,unit));
 const regions=batch.fanouts.length?provenPlanes(native.objects):[];
 for(const q of [...batch.paths,...batch.fanouts]){
  const start=endpoint(doc,q.from,q.net,q.segments?.[0].layer??q.layer);
  const end=q.to?endpoint(doc,q.to,q.net,q.segments?.at(-1).layer??q.layer):point(q.at);
  const points=[start,...q.waypoints.map(point),end];
  if(points.slice(1).some(([x,y],i)=>Math.hypot(x-points[i][0],y-points[i][1])<.1))fail('CONNECTION_ZERO_LENGTH_LEG');
  result.push(...criticalPrimitives(q,points,unit));
  if(!q.to){
   const borders=native.objects.filter(o=>o.kind==='Pour'&&o.net===q.net&&o.pourName===q.plane.toUpperCase());
   if(borders.length!==1||pointInBoardPath(end,parseBoardPath(borders[0].complexPolygon))!=='inside'||q.via.diameter<=q.via.holeDiameter)fail('CONNECTION_PLANE_FANOUT_UNVERIFIED');
   if(!annulusSamples(q,borders[0],regions,unit))fail('CONNECTION_FANOUT_IN_PLANE_VOID');
   result.push({kind:'Via',net:q.net,x:end[0],y:end[1],viaType:0,diameter:toMil(q.via.diameter,unit),holeDiameter:toMil(q.via.holeDiameter,unit),primitiveLock:true});
  }
 }
 if(result.length>320)fail('CONNECTION_BATCH_PRIMITIVE_LIMIT');
 return result.map((o,i)=>({...o,primitiveId:'planned_'+i}));
}
function annulusSamples(f,border,regions,unit){
 const [x,y]=f.at.map(v=>toMil(v,unit)),radius=toMil((f.via.diameter+f.via.holeDiameter)/4,unit);
 const copper=regions.filter(s=>s.boundaryId===border?.primitiveId);
 let wet=0;
 for(let i=0;i<32;i++){
  const q={x:x+radius*Math.cos(i*Math.PI/16),y:y+radius*Math.sin(i*Math.PI/16)};
  if(copper.some(s=>s.surface?surfaceDistance(s.surface,q)<-surfaceTolerance:distanceSegment(q,{x:s.a[0],y:s.a[1]},{x:s.b[0],y:s.b[1]})<s.radius-surfaceTolerance))wet++;
 }
 return wet;
}
export function fanoutContacts(batch,native,unit){
 if(!batch?.fanouts.length)return [];
 const regions=provenPlanes(native.objects),contacts=[];
 for(const f of batch.fanouts){
  const [x,y]=f.at.map(v=>toMil(v,unit)),r=toMil(f.via.diameter,unit)/2,h=toMil(f.via.holeDiameter,unit)/2;
  const b=native.objects.find(o=>o.kind==='Pour'&&o.net===f.net&&o.pourName===f.plane.toUpperCase());
  const via=native.objects.filter(o=>o.kind==='Via'&&o.net===f.net&&Math.hypot(o.x-x,o.y-y)<.0001&&Math.abs(o.diameter/2-r)<.0001&&Math.abs(o.holeDiameter/2-h)<.0001);
  const wet=annulusSamples(f,b,regions,unit);
  contacts.push({pad:f.from,plane:f.plane,via:via[0]?.primitiveId,ringSamplesInCopper:wet,matched:via.length===1&&wet>0});
 }
 return contacts;
}
