import {checkLayout,toMil} from './layout.mjs';
import {knownPartialPredecessor} from './known-partial-stage.mjs';
const near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=0.0001;
export function verifyBoard(plan,native,expectedOutline){
 const issues=[];
 if(native?.status!=='ok'||!Array.isArray(native.objects)||!Number.isInteger(native.layers))return {status:'unknown',issues:[{code:'PCB_BOARD_READBACK_INCOMPLETE'}]};
 const b=plan?.board;if(!b)return {status:'unknown',issues:[{code:'PCB_BOARD_EXPECTATION_MISSING'}]};
 if(native.layers!==b.layers)issues.push({code:'PCB_BOARD_LAYER_COUNT_MISMATCH',expected:b.layers,actual:native.layers});
 const outline=native.objects.filter(x=>x.layer===11),pts=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y-b.height],[b.x,b.y-b.height],[b.x,b.y]];
 const lineRectangle=outline.length===4&&new Set(outline.map(x=>x.primitiveId)).size===4&&pts.slice(0,-1).every((pt,i)=>outline.some(x=>x.kind==='Line'&&(x.net===''||x.net===null)&&x.primitiveLock===true&&near(x.startX,pt[0])&&near(x.startY,pt[1])&&near(x.endX,pts[i+1][0])&&near(x.endY,pts[i+1][1])&&near(x.lineWidth,b.outlineWidth)));
 const poly=outline.length===1?outline[0]:null,v=poly?.polygon;
 const polygonRectangle=poly?.kind==='Polyline'&&(poly.net===''||poly.net===null)&&poly.primitiveLock===true&&near(poly.lineWidth,b.outlineWidth)&&Array.isArray(v)&&v.length===7&&v[0]==='R'&&near(v[1],b.x)&&near(v[2],b.y)&&near(v[3],b.width)&&near(v[4],b.height)&&v[5]===0&&v[6]===0;
 if(!lineRectangle&&!polygonRectangle)issues.push({code:'PCB_BOARD_OUTLINE_MISSING_OR_CHANGED',expectedSegments:4,actualPrimitives:outline.length});
 if(expectedOutline&&![1,4].includes(expectedOutline.length))issues.push({code:'PCB_BOARD_OUTLINE_CHECKPOINT_INCOMPLETE'});
 if(expectedOutline?.some(x=>!outline.some(y=>y.primitiveId===x.primitiveId)))issues.push({code:'PCB_BOARD_OUTLINE_ID_MISMATCH'});
 return {status:issues.length?'mismatch':'matched',issues,outline,layers:native.layers};
}
export function verifyLayoutSnapshot(plan,doc,native,expectedOutline){
 const layout=checkLayout(plan,doc),board=verifyBoard(plan,native,expectedOutline),issues=[...layout.issues,...board.issues];
 return {...layout,status:layout.status==='unknown'||board.status==='unknown'?'unknown':issues.length?'mismatch':'matched',issues,board};
}
export function verifyAddedCopper(action,added,unit){
 const issues=[],nets=action.routing?.nets??[action.critical?.net],layers=action.routing?.layers??[action.critical?.layer];
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
 if(action.critical){
  const {critical:c,points}=action,width=toMil(c.width,unit),log=action.nativeResult?.log??[];
  if(!Array.isArray(points)||points.length<2||added.length!==points.length-1||log.length!==points.length-1)issues.push({code:'PCB_CRITICAL_PATH_COVERAGE_MISMATCH'});
  else for(let i=0;i<points.length-1;i++){
   const x=added.find(x=>x.primitiveId===log[i]?.primitiveId),a=points[i],b=points[i+1];
   if(!x||x.kind!=='Line'||x.net!==c.net||x.layer!==c.layer||x.primitiveLock!==true||!near(x.startX,a[0])||!near(x.startY,a[1])||!near(x.endX,b[0])||!near(x.endY,b[1])||!near(x.lineWidth,width))issues.push({code:'PCB_CRITICAL_PATH_GEOMETRY_MISMATCH',segment:i,id:log[i]?.primitiveId});
  }
 }
 return {status:issues.length?'mismatch':'matched',issues};
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
