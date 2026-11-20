import {z} from 'zod';
import {parseBoardPath,pointInBoardPath,segmentsIntersect} from './board-geometry.mjs';
import {distanceSegment} from './manufacturing-geometry.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {fingerprint} from './drawing.mjs';
import {toMil} from './layout.mjs';
import {pcbSnapshot} from './pcb.mjs';
import {capturePlacementArchives} from './placement-evidence.mjs';
import {unresolvedActions,verifyLayoutSnapshot} from './pcb-validation.mjs';
import {persist} from './workflow.mjs';
import {ruleCheckpointEqual} from './rules.mjs';
import {provenPlanes,surfaceDistance,surfaceSegmentDistance,surfaceTolerance} from './copper-surface.mjs';

export const planeSchema=z.object({
 net:z.string().min(1).max(120),name:z.string().min(1).max(80),
 layer:z.union([z.literal(1),z.literal(2),z.literal(15),z.literal(16)]),
 vertices:z.array(z.array(z.number().finite()).length(2)).min(3).max(64),
 width:z.number().finite().positive().describe('Maximum border width in the selected unit. The editor may return a narrower solid-pour border.')
}).strict();
const same=(a,b)=>fingerprint(a)===fingerprint(b);
const guard=(yes,code)=>{if(!yes)throw Object.assign(new Error(code),{code,status:'unknown'});};
const point=([x,y])=>({x,y});

export function planPlane(plane,unit,record,doc,native){
 const board=record.pcbLayoutBaseline.plan.board,width=toMil(plane.width,unit);
 const vs=plane.vertices.map(p=>p.map(v=>toMil(v,unit))),source=[...vs[0],'L',...vs.slice(1).flat(),...vs[0]];
 const path=parseBoardPath(source);
 guard(path.state==='accepted','PLANE_BOUNDARY_INVALID');
 guard(native.layers===4||[1,2].includes(plane.layer),'PLANE_LAYER_UNAVAILABLE');
 guard(doc.components.some(c=>c.pins.some(p=>p.net===plane.net)),'PLANE_NET_UNKNOWN');
 const config=record.pcbRuleBaseline.config,track=config.Physics.Track.copperThickness1oz.form.data['1'];
 const spacing=config.Spacing['Safe Spacing'].copperThickness1oz,i=spacing.row.indexOf('Copper/Plane Zone'),j=spacing.column.indexOf('Board Outline');
 guard(spacing.unit==='mm'&&i>=0&&j>=0&&width>=toMil(track.minValue,'mm')&&width<=toMil(track.maxValue,'mm'),'PLANE_RULES_UNAVAILABLE');
 const clearance=toMil(spacing.tables['1'].content[Math.max(i,j)][Math.min(i,j)],'mm')+width/2;
 const radius=board.cornerRadius??0;
 for(const [x,y] of vs){
  const dx=Math.abs(x-board.x-board.width/2)-board.width/2+radius,dy=Math.abs(y-board.y+board.height/2)-board.height/2+radius;
  guard(Math.hypot(Math.max(0,dx),Math.max(0,dy))+Math.min(0,Math.max(dx,dy))<=radius-clearance,'PLANE_OUTSIDE_USABLE_BOARD');
 }
 for(const h of board.mountingHoles??[]){
  guard(pointInBoardPath([h.x,h.y],path)==='outside'&&path.segments.every(s=>distanceSegment(h,point(s.start),point(s.end))>=h.keepoutDiameter/2+width/2),'PLANE_MOUNTING_KEEPOUT');
 }
 return {net:plane.net,layer:plane.layer,name:plane.name,width,source};
}

export function matchesFillRecord(row,fill){
 if(row?.type!=='POURED'||fill?.kind!=='Poured'||row.id!==JSON.stringify(['POURED',fill.pourPrimitiveId])||Object.keys(row.body).length!==1)return false;
 const records=row.body.pourFill;
 return Array.isArray(records)&&records.length===fill.pourFills.length&&records.every((r,i)=>{
  const f=fill.pourFills[i];
  return Object.keys(r).length===4&&r.id===f.id&&r.fill===f.fill&&r.strokeWidth===f.lineWidth&&same(r.path,f.path);
 });
}
function diffPlaneArchives(before,after,pcb,plane,creating,fills=[],rebuilt=[]){
 const old=nativeModelRecords(before.pcbData),now=nativeModelRecords(after.pcbData),changes=[];
 if(!same(before.schematic,after.schematic)||!same(before.schematicPages??null,after.schematicPages??null)||!same([...old.keys()].sort(),[...now.keys()].sort()))changes.push({code:'PLANE_DOCUMENT_SET_CHANGED'});
 for(const [uuid,prior] of old){
  const current=now.get(uuid);
  if(!current||uuid!==pcb){if(!current||!same(prior,current))changes.push({code:'PLANE_OTHER_MODEL_CHANGED',uuid});continue;}
  if(!same(prior.tombstones,current.tombstones))changes.push({code:'PLANE_DELETIONS_CHANGED'});
  const key=r=>JSON.stringify([r.type,r.id]),known=new Map(prior.rows.map(r=>[key(r),r]));
  let accepted=0,filled=0;
  const layerCount=current.rows.filter(r=>r.type==='POUR'&&r.body.layerId===plane.layer).length;
  for(const row of current.rows){
   const k=key(row),first=known.get(k);
   if(fills.some(f=>matchesFillRecord(row,f))){filled++;known.delete(k);continue;}
   if(first){known.delete(k);if(!same(first,row)&&!rebuilt.some(pair=>matchesFillRecord(first,pair.before)&&matchesFillRecord(row,pair.after)))changes.push({code:'PLANE_PRIOR_RECORD_CHANGED',type:row.type,id:row.id});continue;}
   const body=row.body;
   if(creating&&row.type==='POUR'&&row.id===plane.primitiveId&&body.netName===plane.net&&body.layerId===plane.layer&&body.locked===true&&body.name===plane.pourName&&body.pourType?.pourType==='SOLID'&&body.keepIsland===false&&body.order===layerCount-plane.pourPriority&&Math.abs(body.width-plane.lineWidth)<.0001&&body.path?.length===1&&samePath(body.path[0],plane.complexPolygon))accepted++;
   else changes.push({code:'PLANE_UNEXPECTED_RECORD',type:row.type,id:row.id,body});
  }
  if(known.size||accepted!==(creating?1:0)||filled!==fills.length)changes.push({code:'PLANE_RECORD_COVERAGE',missing:[...known.keys()],accepted,filled});
 }
 return {status:changes.length?'mismatch':'matched',issues:changes};
}
export async function routePlane(adapter,p,{r,dir},{readDoc,rawRead,routingScript,compareRoutingCheckpoint}){
 guard(r.pcbLayoutBaseline&&r.pcbRuleBaseline&&r.pcbCopperBaseline&&r.renderMode==='headless','PLANE_HEADLESS_ROUTED_STAGE_REQUIRED');
 const doc=await readDoc(adapter,p),before=await rawRead(adapter,p);
 guard(doc.status==='ok'&&before.status==='ok'&&!doc.truncated,'PLANE_READ_INCOMPLETE');
 const layout=verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,before,r.pcbLayoutBaseline.outline);
 guard(layout.status==='matched'&&ruleCheckpointEqual(before.ruleConfiguration,r.pcbRuleBaseline),'PLANE_BASELINE_CHANGED');
 const plan=planPlane(p.plane,p.unit,r,doc,before),hash=fingerprint(plan),key='plane/'+p.requestId;
 r.pcbActions??={};let a=r.pcbActions[key];
 if(a&&a.hash!==hash)return {status:'failed',code:'REQUEST_CONFLICT'};
 if(!a){
  guard(p.phase!=='verify_plane'&&!unresolvedActions(r).length,'PLANE_NO_PENDING_VERIFY_OR_STAGE_BUSY');
  guard(compareRoutingCheckpoint(r.pcbCopperBaseline.native,before).status==='matched','PLANE_SOURCE_COPPER_CHANGED');
  const beforeArchives=await capturePlacementArchives(adapter,p);
  guard(same(beforeArchives.pcb,r.pcbCopperBaseline.archives.pcb)&&same(beforeArchives.schematicPages??null,r.pcbCopperBaseline.archives.schematicPages??null),'PLANE_SOURCE_ARCHIVE_CHANGED');
  const candidates=before.objects.filter(x=>x.kind==='Pour'&&x.pourName.toUpperCase()===plan.name.toUpperCase());
  if(p.phase==='plane')guard(candidates.length===0,'PLANE_NAME_EXISTS');
  else guard(candidates.length===1&&matchesPlane(candidates[0],plan),'PLANE_REBUILD_TARGET_UNVERIFIED');
  a={hash,state:'pending',creating:p.phase==='plane',plan,before:pcbSnapshot(doc),beforeNative:before,beforeArchives};
  r.pcbActions[key]=a;await persist(dir,r);
  if(a.creating){
   a.creation=await adapter.invoke(p.sessionId,routingScript({...p,operation:'create_plane',plan}),15000);await persist(dir,r);
   if(a.creation.status!=='ok')return {...a.creation,requestId:p.requestId};
  }
  const id=a.creation?.id??candidates[0].primitiveId;
  a.rebuildStarted=true;await persist(dir,r);
  a.rebuild=await adapter.invokeLossless(p.sessionId,routingScript({...p,operation:'rebuild_plane',plan,planeId:id}),60000);
  await persist(dir,r);
 }else if(p.phase==='rebuild_plane'&&a.creating&&a.creation?.status==='ok'&&a.rebuild?.code==='PLANE_NATIVE_TARGET_CHANGED'&&!a.rejectedRebuild){
  const id=a.creation.id,existing=before.objects.find(o=>o.kind==='Pour'&&o.primitiveId===id);
  const stripped={...before,objects:before.objects.filter(o=>o!==existing)};
  guard(existing&&matchesPlane(existing,plan)&&compareRoutingCheckpoint(a.beforeNative,stripped).status==='matched','PLANE_DEFERRED_REBUILD_SOURCE_CHANGED');
  const proof=await capturePlacementArchives(adapter,p);
  guard(diffPlaneArchives(a.beforeArchives,proof,p.pcbDocumentUuid,existing,true).status==='matched','PLANE_DEFERRED_REBUILD_ARCHIVE_CHANGED');
  // This rejection is returned before calling the native rebuilder.
  a.rejectedRebuild=a.rebuild;delete a.rebuild;await persist(dir,r);
  a.rebuild=await adapter.invokeLossless(p.sessionId,routingScript({...p,operation:'rebuild_plane',plan,planeId:id}),60000);
  await persist(dir,r);
 }
 const native=await rawRead(adapter,p),afterDoc=await readDoc(adapter,p),archives=await capturePlacementArchives(adapter,p);
 guard(native.status==='ok'&&afterDoc.status==='ok','PLANE_VERIFY_INCOMPLETE');
 const planes=native.objects.filter(o=>o.kind==='Pour'&&o.pourName.toUpperCase()===plan.name.toUpperCase()),plane=planes[0];
 const result={status:'unknown',code:'PLANE_VERIFICATION_INCOMPLETE',creation:a.creation,rebuild:a.rebuild,plan,nativeMutationReplayed:false};
 if(planes.length===1&&matchesPlane(plane,plan)&&(!a.creating||a.creation?.id===plane.primitiveId)){
  const fills=native.objects.filter(x=>x.kind==='Poured'&&x.pourPrimitiveId===plane.primitiveId&&x.layer===plane.layer);
  const prior=n=>({...n,objects:n.objects.filter(o=>!(o.kind==='Poured'&&o.pourPrimitiveId===plane.primitiveId)&&!(a.creating&&o.kind==='Pour'&&o.primitiveId===plane.primitiveId))});
  const priorSource=prior(a.beforeNative),priorNow=prior(native),rebuilt=[];
  const order=n=>n.objects.filter(x=>x.kind==='Pour'&&x.layer===plane.layer).sort((u,v)=>u.pourPriority-v.pourPriority).map(x=>x.primitiveId);
  const ordered=same(order(priorSource),order(priorNow));
  priorNow.objects=priorNow.objects.map(o=>{
   const first=priorSource.objects.find(v=>v.kind===o.kind&&v.primitiveId===o.primitiveId);
   if(!first||o.layer!==plane.layer)return o;
   if(o.kind==='Pour'&&ordered)return {...o,pourPriority:first.pourPriority};
   if(o.kind==='Poured'&&sameFilledGeometry(first,o)){rebuilt.push({before:first,after:o});return {...o,pourFills:first.pourFills};}
   return o;
  });
  const kept=compareRoutingCheckpoint(priorSource,priorNow),coverage=diffPlaneArchives(a.beforeArchives,archives,p.pcbDocumentUuid,plane,a.creating,fills,rebuilt);
  Object.assign(result,{boundary:plane,fills,priorCopper:kept,fullPreservation:coverage});
  if(a.rebuild?.status==='ok'&&fills.length&&fills.every(o=>o.pourFills?.length)&&kept.status==='matched'&&coverage.status==='matched'&&same(a.before,pcbSnapshot(afterDoc))){
   if(a.afterNative&&compareRoutingCheckpoint(a.afterNative,native).status!=='matched')return {...result,code:'PLANE_ACCEPTED_CHECKPOINT_CHANGED'};
   result.status='ok';delete result.code;
   if(a.state!=='completed'){a.state='completed';a.afterNative=native;a.result=result;r.pcbCopperBaseline={native,after:pcbSnapshot(afterDoc),archives};}
  }
 }
 a.lastReadback=result;await persist(dir,r);return result;
}
export function sameFilledGeometry(a,b){
 const content=x=>x.pourFills.map(({fill,lineWidth,path})=>fingerprint([fill,lineWidth,path])).sort();
 return a.layer===b.layer&&a.pourPrimitiveId===b.pourPrimitiveId&&same(content(a),content(b));
}
export function sameStoredFills(expected,actual){
 const pathEqual=(a,b)=>Array.isArray(a)?Array.isArray(b)&&a.length===b.length&&a.every((x,i)=>pathEqual(x,b[i])):typeof a==='number'?typeof b==='number'&&Math.abs(a-b)<=1e-10:a===b;
 return Array.isArray(expected)&&Array.isArray(actual)&&expected.length===actual.length&&expected.every((a,i)=>{
  const b=actual[i];return a.id===b.id&&a.fill===b.fill&&a.lineWidth===b.lineWidth&&pathEqual(a.path,b.path);
 });
}
function matchesPlane(o,p){
 return o.net===p.net&&o.layer===p.layer&&o.pourName.toUpperCase()===p.name.toUpperCase()&&o.primitiveLock===true&&o.pourFillMethod==='solid'&&o.preserveSilos===false&&o.lineWidth>0&&o.lineWidth<=p.width+.0001&&samePath(p.source,o.complexPolygon);
}
function samePath(a,b){
 const expected=parseBoardPath(a),actual=parseBoardPath(b);
 return expected.state==='accepted'&&actual.state==='accepted'&&expected.vertices.length===actual.vertices.length&&expected.vertices.every(([x,y],i)=>Math.hypot(x-actual.vertices[i][0],y-actual.vertices[i][1])<.0001);
}
export function checkFilledClearance(native,added,rules){
 const regions=provenPlanes(native.objects),spacing=rules.config.Spacing['Safe Spacing'].copperThickness1oz,issues=[];
 const k=spacing.row.indexOf('Copper/Plane Zone');
 for(const o of added){
  const via=o.kind==='Via',j=spacing.row.indexOf(via?'Via':'Track'),minimum=spacing.tables['1'].content[Math.max(j,k)]?.[Math.min(j,k)];
  if(k<0||j<0||!Number.isFinite(minimum)||spacing.unit!=='mm')throw Error('PLANE_CLEARANCE_RULE_UNKNOWN');
  for(const p of regions){
   if(o.net===p.net||!via&&o.layer!==p.layer)continue;
   const a=via?[o.x,o.y]:[o.startX,o.startY],b=via?a:[o.endX,o.endY];
   let distance;
   if(p.surface)distance=via?surfaceDistance(p.surface,point(a)):surfaceSegmentDistance(p.surface,a,b);
   else distance=(segmentsIntersect(a,b,p.a,p.b)?0:Math.min(distanceSegment(point(a),point(p.a),point(p.b)),distanceSegment(point(b),point(p.a),point(p.b)),distanceSegment(point(p.a),point(a),point(b)),distanceSegment(point(p.b),point(a),point(b))))-p.radius;
   const gap=distance-(via?o.diameter:o.lineWidth)/2;
   if(gap+surfaceTolerance<toMil(minimum,'mm'))issues.push({code:'REFILLED_COPPER_CLEARANCE',object:o.primitiveId,plane:p.id,gapMil:gap,minimumMm:minimum});
  }
 }
 return {status:issues.length?'mismatch':'matched',issues};
}
