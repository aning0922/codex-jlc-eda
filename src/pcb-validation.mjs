import {checkLayout,toMil} from './layout.mjs';
import {knownPartialPredecessor} from './known-partial-stage.mjs';
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.0001;
export function verifyBoard(plan,native,expectedOutline){
 const issues=[];
 if(native?.status!=='ok'||!Array.isArray(native.objects)||!Number.isInteger(native.layers))return {status:'unknown',issues:[{code:'PCB_BOARD_READBACK_INCOMPLETE'}]};
 const b=plan?.board;if(!b)return {status:'unknown',issues:[{code:'PCB_BOARD_EXPECTATION_MISSING'}]};
 if(native.layers!==b.layers)issues.push({code:'PCB_BOARD_LAYER_COUNT_MISMATCH',expected:b.layers,actual:native.layers});
 const outline=native.objects.filter(x=>x.layer===11),pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y-b.height],[b.x,b.y-b.height],[b.x,b.y]];
 const lineRectangle=!b.cornerRadius&&outline.length===4&&new Set(outline.map(x=>x.primitiveId)).size===4&&pts.slice(0,-1).every((pt,i)=>outline.some(x=>x.kind==='Line'&&(x.net===''||x.net===null)&&x.primitiveLock===true&&near(x.startX,pt[0])&&near(x.startY,pt[1])&&near(x.endX,pts[i+1][0])&&near(x.endY,pts[i+1][1])&&near(x.lineWidth,b.outlineWidth)));
 const poly=outline.length===1?outline[0]:null,v=poly?.polygon;
 const polygonRectangle=poly?.kind==='Polyline'&&(poly.net===''||poly.net===null)&&poly.primitiveLock===true&&near(poly.lineWidth,b.outlineWidth)&&Array.isArray(v)&&v.length===7&&v[0]==='R'&&near(v[1],b.x)&&near(v[2],b.y)&&near(v[3],b.width)&&near(v[4],b.height)&&v[5]===0&&near(v[6],b.cornerRadius??0);
 if(!lineRectangle&&!polygonRectangle)issues.push({code:'PCB_BOARD_OUTLINE_MISSING_OR_CHANGED',expectedSegments:4,actualPrimitives:outline.length});
 if(expectedOutline&&![1,4].includes(expectedOutline.length))issues.push({code:'PCB_BOARD_OUTLINE_CHECKPOINT_INCOMPLETE'});
 if(expectedOutline?.some(x=>!outline.some(y=>y.primitiveId===x.primitiveId)))issues.push({code:'PCB_BOARD_OUTLINE_ID_MISMATCH'});
 const holes=native.objects.filter(o=>o.kind==='Fill'&&o.layer===12);
 if(b.mountingHoles){
  const claimed=new Set();
  for(const h of b.mountingHoles){
   const found=holes.filter(o=>{const v=o.complexPolygon;return o.primitiveLock===true&&!o.net&&o.fillMode===0&&Array.isArray(v)&&v.length===4&&v[0]==='CIRCLE'&&near(v[1],h.x)&&near(v[2],h.y)&&near(v[3],h.diameter/2);});
   if(found.length===1)claimed.add(found[0].primitiveId);else issues.push({code:'PCB_MOUNTING_HOLE_GEOMETRY',hole:h});
  }
  if(claimed.size!==b.mountingHoles.length||holes.length!==claimed.size)issues.push({code:'PCB_MOUNTING_HOLE_POPULATION'});
 }
 return {status:issues.length?'mismatch':'matched',issues,outline,layers:native.layers,...(b.mountingHoles?{mountingHoles:holes}:{})};
}
export function verifyLayoutSnapshot(plan,doc,native,expectedOutline){
 const layout=checkLayout(plan,doc),board=verifyBoard(plan,native,expectedOutline),issues=[...layout.issues,...board.issues];
 return {...layout,status:layout.status==='unknown'||board.status==='unknown'?'unknown':issues.length?'mismatch':'matched',issues,board};
}
export function criticalPrimitives(c,points,unit){
 const objects=[];
 for(let i=0;i<points.length-1;i++){
  const section=c.segments?.[i]??c,[startX,startY]=points[i],[endX,endY]=points[i+1];
  if(i&&c.segments&&section.layer!==c.segments[i-1].layer)
   objects.push({kind:'Via',primitiveId:'planned_via_'+i,net:c.net,x:startX,y:startY,viaType:0,diameter:toMil(c.via.diameter,unit),holeDiameter:toMil(c.via.holeDiameter,unit),primitiveLock:true});
  objects.push({kind:'Line',primitiveId:'planned_line_'+i,net:c.net,layer:section.layer,startX,startY,endX,endY,lineWidth:toMil(section.width,unit),primitiveLock:true});
 }
 return objects;
}
// The editor can replace adjacent new collinear strokes with one reversed LINE.
export function criticalRuns(objects,readbackToleranceMil=0){
 const runs=[];
 for(const [i,line] of objects.entries()){
  const prev=runs.at(-1)?.object;
  if(prev?.kind==='Line'&&line.kind==='Line'&&prev.net===line.net&&prev.layer===line.layer&&prev.lineWidth===line.lineWidth&&prev.primitiveLock===line.primitiveLock&&prev.endX===line.startX&&prev.endY===line.startY){
   const dx=prev.endX-prev.startX,dy=prev.endY-prev.startY,nx=line.endX-line.startX,ny=line.endY-line.startY;
   const ex=line.endX-prev.startX,ey=line.endY-prev.startY,length=Math.hypot(ex,ey);
   const nearLine=readbackToleranceMil>0&&length>0&&runs.at(-1).indices.every(j=>{
    const p=objects[j],px=p.endX-prev.startX,py=p.endY-prev.startY;
    return Math.abs(px*ey-py*ex)<=readbackToleranceMil*length&&px*ex+py*ey>=0&&px*ex+py*ey<=length*length;
   });
   if(dx*nx+dy*ny>0&&(Math.abs(dx*ny-dy*nx)<=1e-8*Math.hypot(dx,dy)||nearLine)){
    runs.at(-1).object={...prev,endX:line.endX,endY:line.endY};runs.at(-1).indices.push(i);continue;
   }
  }
  runs.push({object:line,indices:[i]});
 }
 return runs;
}
function sameCritical(want,x,allowReverse=false){
 if(!x||x.kind!==want.kind||x.net!==want.net||x.primitiveLock!==true)return false;
 if(want.kind==='Via')return x.viaType===0&&['x','y','diameter','holeDiameter'].every(k=>near(x[k],want[k]));
 if(x.layer!==want.layer||!near(x.lineWidth,want.lineWidth))return false;
 const ends=['startX','startY','endX','endY'],reversed=['endX','endY','startX','startY'];
 return ends.every(k=>near(x[k],want[k]))||allowReverse&&ends.every((k,i)=>near(x[k],want[reversed[i]]));
}
function profiledReadback(action,raw,added){
 if(!Array.isArray(action.pathPlan.objects)||!Array.isArray(action.beforeNative?.objects))return null;
 const submitted=action.pathPlan.objects,log=action.nativeResult?.log??[],original=new Set(action.beforeNative.objects.map(x=>x.primitiveId)),written=new Set(log.map(x=>x?.primitiveId));
 const expected=submitted.length===raw.length?raw:criticalRuns(raw).map(r=>r.object);
 if(!raw.length||action.nativeResult?.status!=='ok'||submitted.length!==expected.length||log.length!==submitted.length||written.size!==log.length||!log.every((x,i)=>x?.primitiveId&&!original.has(x.primitiveId)&&sameCritical(expected[i],submitted[i])&&sameCritical(submitted[i],x)))return null;
 const available=new Map(added.map(x=>[x.primitiveId,x])),groups=[];
 if(available.size!==added.length||added.some(x=>!x.primitiveId||original.has(x.primitiveId)))return null;
 // Reopened native copper can merge a join within 0.127 µm of the chord. The two outer endpoints remain exact.
 for(const {object,indices} of criticalRuns(submitted,.005)){
  const provisional=indices.map(i=>log[i].primitiveId);
  let actual=provisional;
  if(!indices.every(i=>sameCritical(submitted[i],available.get(log[i].primitiveId)))){
   if(indices.length===1)return null;
   const candidates=[...available.values()].filter(x=>(!written.has(x.primitiveId)||provisional.includes(x.primitiveId))&&sameCritical(object,x,true));
   if(candidates.length!==1)return null;
   actual=[candidates[0].primitiveId];
  }
  for(const id of actual)available.delete(id);
  groups.push({provisional,actual});
 }
 return available.size?null:{validatedCreates:log.length,groups};
}
export function verifyAddedCopper(action,added,unit,batchExpected){
 const issues=[],nets=batchExpected?batchExpected.map(o=>o.net):action.routing?.nets??[action.critical?.net],layers=batchExpected?[...new Set(batchExpected.flatMap(o=>o.kind==='Via'?[1,2]:[o.layer]))]:action.routing?.layers??action.critical?.segments?.map(s=>s.layer)??[action.critical?.layer];
 for(const x of added){
  if(!nets.includes(x.net)||action.routing?.ignoreNets?.includes(x.net))issues.push({code:'PCB_ROUTE_ADDED_NET_OUTSIDE_SCOPE',id:x.primitiveId,net:x.net});
  if(x.kind==='Line'){
   if(!layers.includes(x.layer))issues.push({code:'PCB_ROUTE_ADDED_LAYER_OUTSIDE_SCOPE',id:x.primitiveId,layer:x.layer,allowed:layers});
   if(![x.startX,x.startY,x.endX,x.endY,x.lineWidth].every(Number.isFinite)||x.lineWidth<=0)issues.push({code:'PCB_ROUTE_ADDED_LINE_GEOMETRY_INCOMPLETE',id:x.primitiveId});
  }else if(x.kind==='Via'){
   if(x.viaType!==0||!layers.includes(1)||!layers.includes(2))issues.push({code:'PCB_ROUTE_ADDED_VIA_SPAN_OUTSIDE_SCOPE',id:x.primitiveId,viaType:x.viaType,supportedSpan:[1,2],allowed:layers});
   if(![x.x,x.y,x.diameter,x.holeDiameter].every(Number.isFinite)||x.holeDiameter<=0||x.diameter<=x.holeDiameter)issues.push({code:'PCB_ROUTE_ADDED_VIA_GEOMETRY_INCOMPLETE',id:x.primitiveId});
  }else issues.push({code:'PCB_ROUTE_ADDED_PRIMITIVE_UNSUPPORTED',id:x.primitiveId,kind:x.kind});
 }
 let criticalReadback;
 if(action.critical||action.batch){
  const {critical:c,points}=action,log=action.nativeResult?.log??[],expected=batchExpected??(Array.isArray(points)?criticalPrimitives(c,points,unit):[]);
  if(action.pathPlan){
   criticalReadback=profiledReadback(action,expected,added);
   if(!criticalReadback)issues.push({code:'PCB_CRITICAL_PATH_COVERAGE_MISMATCH'});
  }else if(!expected.length||added.length!==expected.length||log.length!==expected.length||new Set(log.map(x=>x.primitiveId)).size!==expected.length)issues.push({code:'PCB_CRITICAL_PATH_COVERAGE_MISMATCH'});
  else for(const [i,want]of expected.entries()){
   const x=added.find(x=>x.primitiveId===log[i]?.primitiveId);
   if(!sameCritical(want,x))issues.push({code:'PCB_CRITICAL_PATH_GEOMETRY_MISMATCH',segment:i,id:log[i]?.primitiveId});
  }
 }
 return {status:issues.length?'mismatch':'matched',issues,...(!issues.length&&criticalReadback?{criticalReadback}:{})};
}
export function confirmedTerminatedAction(action){
 const t=action?.termination;return !!(action?.state==='terminated'&&t?.executionEnded===true&&t.outcome==='unknown_not_success'&&t.closed?.status==='ok'&&t.closed.sessionNoLongerAlive===true&&t.closed.editorWindowDestroyed===true&&t.preservation?.persistenceVerified===true&&t.preservation.fullDesignArchiveCompared===true&&typeof t.preservation.sourceSha256==='string'&&t.targetSessionId&&t.targetPath&&t.closed.sessionId===t.targetSessionId);
}
export function confirmedFailedStageAction(action){
 const f=action?.failurePreservation;
 return !!(action?.state==='failed_preserved'&&action.invalidation&&f?.outcome==='rolled_back_ui_route_not_success'&&f.operationSucceeded===false&&f.designReady===false&&f.closed?.status==='ok'&&f.closed.sessionId===f.targetSessionId&&f.closed.sessionNoLongerAlive===true&&f.closed.editorWindowDestroyed===true&&f.preservation?.persistenceVerified===true&&f.preservation.fullDesignArchiveCompared===true&&f.preservation.rollbackStageComparison?.status==='matched'&&typeof f.preservation.sourceSha256==='string'&&f.targetPath);
}
export function unresolvedActions(record){
 return [['schematic',record.actions],['sync',record.pcbSyncActions],['pcb',record.pcbActions],['file',record.fileRouteActions],['file_export',record.fileExports],['repair',record.pcbRepairActions],['context_refresh',record.contextRefreshes]].flatMap(([scope,actions])=>Object.entries(actions??{}).filter(([key,action])=>(action.state!=='completed'||!!action.invalidation)&&!knownPartialPredecessor(record,scope,key,action)&&!(scope==='pcb'&&key.startsWith('route/')&&(confirmedTerminatedAction(action)||confirmedFailedStageAction(action)))).map(([key,action])=>({scope,key,state:action.state??'missing'})));
}
