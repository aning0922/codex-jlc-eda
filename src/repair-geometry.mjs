import {fingerprint} from './drawing.mjs';
import {toMil} from './layout.mjs';
import {segmentsIntersect} from './board-geometry.mjs';
const dist=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],t=(dx*dx+dy*dy)?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy))):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
const sd=(a,b,c,d)=>segmentsIntersect(a,b,c,d)?0:Math.min(dist(a,c,d),dist(b,c,d),dist(c,a,b),dist(d,a,b));
function padObstacle(p){
 const [shape,w,h]=p.padShape??[],angle=p.rotation*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),rot=([x,y])=>[p.x+x*c-y*s,p.y+x*s+y*c],inflate=.055;
 if(!['RECT','OVAL','ELLIPSE'].includes(shape)||![p.x,p.y,w,h,p.rotation].every(Number.isFinite)||w<=0||h<=0||shape==='ELLIPSE'&&Math.abs(w-h)>.051)throw Error('REPAIR_OBSTACLE_PAD_UNSUPPORTED');
 if(shape==='RECT'){const poly=[[-w/2-inflate,-h/2-inflate],[w/2+inflate,-h/2-inflate],[w/2+inflate,h/2+inflate],[-w/2-inflate,h/2+inflate]].map(rot);return {poly};}
 const radius=Math.min(w,h)/2+inflate,delta=(Math.max(w,h)-Math.min(w,h))/2,axis=w>=h?[delta,0]:[0,delta];return {a:rot(axis.map(x=>-x)),b:rot(axis),radius};
}
function separation(a,b){
 if(b.poly){const angle=(p,q,r)=>(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);if([a.a,a.b].some(p=>b.poly.every((q,i)=>angle(q,b.poly[(i+1)%4],p)>=0)))return -a.radius;return Math.min(...b.poly.map((q,i)=>sd(a.a,a.b,q,b.poly[(i+1)%4])))-a.radius;}
 return sd(a.a,a.b,b.a,b.b)-a.radius-b.radius;
}
export function planRepair(input,document,native,record){
 const issues=[],objects=[],intent=record.continuation?.selectedStage?.intent,board=record.pcbLayoutBaseline?.plan?.board;
 if(!intent||!board)throw Error('REPAIR_KNOWN_PARTIAL_BASELINE_REQUIRED');
 const pin=e=>{const c=document.components.filter(c=>c.uniqueId===e.uniqueId),p=c.length===1?c[0].pins.filter(p=>p.number===e.pin):[];if(p.length!==1)throw Error('REPAIR_ENDPOINT_AMBIGUOUS');return p[0];};
 const mm=v=>toMil(v,input.unit),from=pin(input.from),to=pin(input.to);
 if(!intent.nets.includes(input.net)||from.net!==input.net||to.net!==input.net)throw Error('REPAIR_NET_OR_ENDPOINT_OUTSIDE_INTENT');
 for(const [i,path]of input.paths.entries())for(let j=0;j<path.points.length-1;j++){const [a,b]=[path.points[j],path.points[j+1]].map(p=>p.map(mm));if(Math.hypot(a[0]-b[0],a[1]-b[1])<.1)throw Error('REPAIR_DEGENERATE_SEGMENT');objects.push({kind:'Line',primitiveId:'planned_line_'+i+'_'+j,net:input.net,layer:path.layer,startX:a[0],startY:a[1],endX:b[0],endY:b[1],lineWidth:mm(path.width),primitiveLock:true});}
 for(const [i,v]of input.vias.entries())objects.push({kind:'Via',primitiveId:'planned_via_'+i,net:input.net,x:mm(v.at[0]),y:mm(v.at[1]),diameter:mm(v.diameter),holeDiameter:mm(v.holeDiameter),viaType:0,primitiveLock:true});
 const spacing=record.pcbRuleBaseline?.config?.Spacing?.['Safe Spacing']?.copperThickness1oz,track=record.pcbRuleBaseline?.config?.Physics?.Track?.copperThickness1oz?.form?.data?.['1'];
 const viaRules=record.pcbRuleBaseline?.config?.Physics?.['Via Size']?.viaSize?.form;
 if(spacing?.unit!=='mm'||spacing.tables?.['1']?.status!==1||track?.minValue==null||track.maxValue==null)throw Error('REPAIR_RULE_FORMAT_UNSUPPORTED');
 const clearance=(ak,bk)=>{const i=spacing.row.indexOf(ak),j=spacing.column.indexOf(bk),v=spacing.tables['1'].content[Math.max(i,j)]?.[Math.min(i,j)];if(i<0||j<0||!Number.isFinite(v))throw Error('REPAIR_SPACING_VALUE_UNAVAILABLE');return toMil(v,'mm');};
 const item=x=>x.kind==='Line'?{a:[x.startX,x.startY],b:[x.endX,x.endY],radius:x.lineWidth/2,net:x.net,layers:[x.layer],ruleKind:'Track',id:x.primitiveId}:{a:[x.x,x.y],b:[x.x,x.y],radius:x.diameter/2,net:x.net,layers:[1,2],ruleKind:'Via',id:x.primitiveId};
 const obstacles=native.objects.filter(x=>x.kind==='Via'||x.kind==='Line'&&[1,2].includes(x.layer)).map(item);
 for(const c of document.components)for(const p of c.pins)obstacles.push({...padObstacle(p),net:p.net,layers:p.layer===12?[1,2]:[p.layer],ruleKind:p.layer===12?'TH Pad':'SMD Pad',id:p.id});
 let minimumMargin=Infinity;
 for(const x of objects){const q=item(x),edge=clearance(q.ruleKind,'Board Outline');for(const pt of [q.a,q.b])if(pt[0]-q.radius<board.x+edge||pt[0]+q.radius>board.x+board.width-edge||pt[1]+q.radius>board.y-edge||pt[1]-q.radius<board.y-board.height+edge)issues.push({code:'REPAIR_COPPER_BOARD_CLEARANCE',id:q.id});
  if(x.kind==='Line'&&(x.lineWidth<toMil(track.minValue,'mm')||x.lineWidth>toMil(track.maxValue,'mm')))issues.push({code:'REPAIR_LINE_WIDTH_OUTSIDE_RULES',id:q.id});
  if(x.kind==='Via'&&(!viaRules||x.holeDiameter>=x.diameter||x.holeDiameter<toMil(viaRules.viaInnerdiameterMin,'mm')||x.holeDiameter>toMil(viaRules.viaInnerdiameterMax,'mm')||x.diameter<toMil(viaRules.viaOuterdiameterMin,'mm')||x.diameter>toMil(viaRules.viaOuterdiameterMax,'mm')))issues.push({code:'REPAIR_VIA_DIMENSIONS_INVALID',id:q.id});
  for(const o of obstacles)if(o.net!==q.net&&o.layers.some(l=>q.layers.includes(l))){const margin=separation(q,o)-clearance(q.ruleKind,o.ruleKind);minimumMargin=Math.min(minimumMargin,margin);if(margin<0)issues.push({code:'REPAIR_OBSTACLE_CLEARANCE',id:q.id,obstacle:o.id,net:o.net,marginMil:margin});}
 }
 return {status:issues.length?'mismatch':'matched',issues,objects,from,to,minimumForeignCopperMarginMil:Number.isFinite(minimumMargin)?minimumMargin:null,sourceFingerprint:fingerprint({document,native,baseline:record.pcbRepairBaseline}),qualification:'Conservative source-pad envelope and actual tracks/vias with current native clearance matrix. Native strict DRC remains mandatory.'};
}
