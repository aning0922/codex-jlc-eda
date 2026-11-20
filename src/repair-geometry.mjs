import {fingerprint} from './drawing.mjs';
import {toMil} from './layout.mjs';
import {segmentsIntersect} from './board-geometry.mjs';
import {provenPlanes,surfaceParts,surfaceDistance,surfaceSegmentDistance} from './copper-surface.mjs';
const dist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=(dx*dx+dy*dy)?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const sd=(a,b,c,d)=>segmentsIntersect(a,b,c,d)?0:Math.min(dist(a,c,d),dist(b,c,d),dist(c,a,b),dist(d,a,b));
function padObstacle(p,bounds){
 const [shape,w,h]=p.padShape??[],angle=p.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rot=([x,y])=>[p.x+x*c-y*s,p.y+x*s+y*c],inflate=.055;
 if(shape==='POLYGON'&&bounds&&[bounds.minX,bounds.minY,bounds.maxX,bounds.maxY].every(Number.isFinite)&&p.x>=bounds.minX&&p.x<=bounds.maxX&&p.y>=bounds.minY&&p.y<=bounds.maxY){
  try{
   const surfaces=surfaceParts(p.padShape[1]);
   if(surfaces.some(s=>surfaceDistance(s,{x:p.x,y:p.y})<0))return {surfaces,inflate};
  }catch{}
  const {minX,minY,maxX,maxY}=bounds;
  return {poly:[[minX-inflate,minY-inflate],[maxX+inflate,minY-inflate],[maxX+inflate,maxY+inflate],[minX-inflate,maxY+inflate]]};
 }
 if(!['RECT','OVAL','ELLIPSE'].includes(shape)||![p.x,p.y,w,h,p.rotation].every(Number.isFinite)||w<=0||h<=0||shape==='ELLIPSE'&&Math.abs(w-h)>.051)throw Error('REPAIR_OBSTACLE_PAD_UNSUPPORTED');
 if(shape==='RECT'){const poly=[[-w/2-inflate,-h/2-inflate],[w/2+inflate,-h/2-inflate],[w/2+inflate,h/2+inflate],[-w/2-inflate,h/2+inflate]].map(rot);return {poly};}
 const radius=Math.min(w,h)/2+inflate,delta=(Math.max(w,h)-Math.min(w,h))/2,axis=w>=h?[delta,0]:[0,delta];return {a:rot(axis.map(x=>-x)),b:rot(axis),radius};
}
function separation(a,b){
 if(b.surfaces)return Math.min(...b.surfaces.map(s=>surfaceSegmentDistance(s,a.a,a.b)))-a.radius-b.inflate;
 if(b.poly){const angle=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if([a.a,a.b].some(p=>b.poly.every((q,i)=>angle(q,b.poly[(i+1)%4],p)>=0)))return -a.radius;return Math.min(...b.poly.map((q,i)=>sd(a.a,a.b,q,b.poly[(i+1)%4])))-a.radius;}
 return sd(a.a,a.b,b.a,b.b)-a.radius-b.radius;
}
// The editor splits or replaces existing tracks when same-net centre lines overlap or meet inside a segment.
function wouldSplitTrace(a,b){
 const same=(p,q)=>Math.hypot(p[0]-q[0],p[1]-q[1])<.0001;
 const inside=(p,s)=>!same(p,s.a)&&!same(p,s.b)&&dist(p,s.a,s.b)<.0001;
 if(inside(a.a,b)||inside(a.b,b)||inside(b.a,a)||inside(b.b,a))return true;
 const sharedStart=same(a.a,b.a)||same(a.a,b.b),sharedEnd=same(a.b,b.a)||same(a.b,b.b);
 if(sharedStart||sharedEnd)return sharedStart&&sharedEnd&&!same(a.a,a.b);
 return segmentsIntersect(a.a,a.b,b.a,b.b);
}
function parallelSnap(a,b){
 const dx=a.b[0]-a.a[0],dy=a.b[1]-a.a[1],ex=b.b[0]-b.a[0],ey=b.b[1]-b.a[1],la=Math.hypot(dx,dy),lb=Math.hypot(ex,ey);
 if(la<3||lb<3||Math.abs(dx*ey-dy*ex)>.08*la*lb)return false;
 const t=p=>((p[0]-a.a[0])*dx+(p[1]-a.a[1])*dy)/la,ends=[t(b.a),t(b.b)].sort((x,y)=>x-y);
 return Math.min(la,ends[1])-Math.max(0,ends[0])>2.75&&sd(a.a,a.b,b.a,b.b)<=3.2;
}
export function planRepair(input,document,native,record){
 const objects=[],intent=record.continuation?.selectedStage?.intent,board=record.pcbLayoutBaseline?.plan?.board;
 if(!intent||!board)throw Error('REPAIR_KNOWN_PARTIAL_BASELINE_REQUIRED');
 const pin=e=>{const c=document.components.filter(c=>c.uniqueId===e.uniqueId),p=c.length===1?c[0].pins.filter(p=>p.number===e.pin):[];if(p.length!==1)throw Error('REPAIR_ENDPOINT_AMBIGUOUS');return p[0];};
 const mm=v=>toMil(v,input.unit),from=pin(input.from),to=pin(input.to);
 if(!intent.nets.includes(input.net)||from.net!==input.net||to.net!==input.net)throw Error('REPAIR_NET_OR_ENDPOINT_OUTSIDE_INTENT');
 for(const [i,path]of input.paths.entries())for(let j=0;j<path.points.length-1;j++){const [a,b]=[path.points[j],path.points[j+1]].map(p=>p.map(mm));if(Math.hypot(a[0]-b[0],a[1]-b[1])<.1)throw Error('REPAIR_DEGENERATE_SEGMENT');objects.push({kind:'Line',primitiveId:'planned_line_'+i+'_'+j,net:input.net,layer:path.layer,startX:a[0],startY:a[1],endX:b[0],endY:b[1],lineWidth:mm(path.width),primitiveLock:true});}
 for(const [i,v]of input.vias.entries())objects.push({kind:'Via',primitiveId:'planned_via_'+i,net:input.net,x:mm(v.at[0]),y:mm(v.at[1]),diameter:mm(v.diameter),holeDiameter:mm(v.holeDiameter),viaType:0,primitiveLock:true});
 return {...checkPlannedCopper(objects,document,native,record),objects,from,to,sourceFingerprint:fingerprint({document,native,baseline:record.pcbRepairBaseline}),qualification:'Conservative source-pad envelope and actual tracks/vias with current native clearance matrix. Native strict DRC remains mandatory.'};
}
export function checkPlannedCopper(objects,document,native,record,{preserveExistingRoutes=false,avoidParallelSnap=false}={}){
 const issues=[],board=record.pcbLayoutBaseline.plan.board;
 if(preserveExistingRoutes){
  if(preserveExistingRoutes)provenPlanes(native.objects);
  const unsupported=native.objects.find(o=>!(o.kind==='Line'&&[1,2].includes(o.layer)||o.kind==='Via'&&o.viaType===0||preserveExistingRoutes&&['Pour','Poured'].includes(o.kind)||!o.net&&(o.layer===11||o.kind==='Fill'&&o.layer===12&&o.complexPolygon?.[0]==='CIRCLE')));
  if(unsupported)throw Error('CRITICAL_COPPER_OBSTACLE_UNSUPPORTED');
 }
 const spacing=record.pcbRuleBaseline?.config?.Spacing?.['Safe Spacing']?.copperThickness1oz,track=record.pcbRuleBaseline?.config?.Physics?.Track?.copperThickness1oz?.form?.data?.['1'];
 const viaRules=record.pcbRuleBaseline?.config?.Physics?.['Via Size']?.viaSize?.form;
 if(spacing?.unit!=='mm'||spacing.tables?.['1']?.status!==1||track?.minValue==null||track.maxValue==null)throw Error('REPAIR_RULE_FORMAT_UNSUPPORTED');
 const clearance=(ak,bk)=>{const i=spacing.row.indexOf(ak),j=spacing.column.indexOf(bk),v=spacing.tables['1'].content[Math.max(i,j)]?.[Math.min(i,j)];if(i<0||j<0||!Number.isFinite(v))throw Error('REPAIR_SPACING_VALUE_UNAVAILABLE');return toMil(v,'mm');};
 const item=x=>x.kind==='Line'?{a:[x.startX,x.startY],b:[x.endX,x.endY],radius:x.lineWidth/2,net:x.net,layers:[x.layer],ruleKind:'Track',id:x.primitiveId}:{a:[x.x,x.y],b:[x.x,x.y],radius:x.diameter/2,holeDiameter:x.holeDiameter,net:x.net,layers:[1,2],ruleKind:'Via',id:x.primitiveId};
 const obstacles=native.objects.filter(x=>x.kind==='Via'||x.kind==='Line'&&[1,2].includes(x.layer)).map(item);
 for(const c of document.components)for(const p of c.pins)obstacles.push({...padObstacle(p,preserveExistingRoutes?c.primitiveBounds:undefined),net:p.net,layers:p.layer===12?[1,2]:[p.layer],ruleKind:p.layer===12?'TH Pad':'SMD Pad',id:p.id});
 let minimumMargin=Infinity;
 for(const x of objects){const q=item(x),edge=clearance(q.ruleKind,'Board Outline');for(const pt of [q.a,q.b])if(pt[0]-q.radius<board.x+edge||pt[0]+q.radius>board.x+board.width-edge||pt[1]+q.radius>board.y-edge||pt[1]-q.radius<board.y-board.height+edge)issues.push({code:'REPAIR_COPPER_BOARD_CLEARANCE',id:q.id});
  if(preserveExistingRoutes){
   for(const h of board.mountingHoles??[])if(dist([h.x,h.y],q.a,q.b)<q.radius+h.keepoutDiameter/2)issues.push({code:'CRITICAL_MOUNTING_HOLE_KEEPOUT',id:q.id});
   const r=board.cornerRadius??0;
   if(r)for(const [x,y]of [q.a,q.b]){
    const dx=Math.abs(x-board.x-board.width/2)-board.width/2+r,dy=Math.abs(y-board.y+board.height/2)-board.height/2+r;
    if(Math.hypot(Math.max(0,dx),Math.max(0,dy))+Math.min(0,Math.max(dx,dy))>r-edge-q.radius)issues.push({code:'CRITICAL_CORNER_CLEARANCE',id:q.id});
   }
  }
  if(x.kind==='Line'&&(x.lineWidth<toMil(track.minValue,'mm')||x.lineWidth>toMil(track.maxValue,'mm')))issues.push({code:'REPAIR_LINE_WIDTH_OUTSIDE_RULES',id:q.id});
  if(x.kind==='Via'&&(!viaRules||x.holeDiameter>=x.diameter||x.holeDiameter<toMil(viaRules.viaInnerdiameterMin,'mm')||x.holeDiameter>toMil(viaRules.viaInnerdiameterMax,'mm')||x.diameter<toMil(viaRules.viaOuterdiameterMin,'mm')||x.diameter>toMil(viaRules.viaOuterdiameterMax,'mm')))issues.push({code:'REPAIR_VIA_DIMENSIONS_INVALID',id:q.id});
  for(const o of obstacles)if(o.net!==q.net&&o.layers.some(l=>q.layers.includes(l))){const margin=separation(q,o)-clearance(q.ruleKind,o.ruleKind);minimumMargin=Math.min(minimumMargin,margin);if(margin<0)issues.push({code:'REPAIR_OBSTACLE_CLEARANCE',id:q.id,obstacle:o.id,net:o.net,marginMil:margin});}
  if(preserveExistingRoutes){
   for(const o of obstacles)if(o.net===q.net&&['Track','Via'].includes(o.ruleKind)&&o.layers.some(l=>q.layers.includes(l))){
    if(q.ruleKind==='Via'&&o.ruleKind==='Via'&&Math.hypot(q.a[0]-o.a[0],q.a[1]-o.a[1])<(x.holeDiameter+o.holeDiameter)/2)
     issues.push({code:'CRITICAL_OVERLAPPING_VIA_DRILLS',id:q.id,obstacle:o.id});
    else if(wouldSplitTrace(q,o)||avoidParallelSnap&&q.ruleKind==='Track'&&o.ruleKind==='Track'&&parallelSnap(q,o))issues.push({code:'CRITICAL_EXISTING_TRACE_JUNCTION',id:q.id,obstacle:o.id});
   }
   obstacles.push(q);
  }
 }
 return {status:issues.length?'mismatch':'matched',issues,minimumForeignCopperMarginMil:Number.isFinite(minimumMargin)?minimumMargin:null};
}
