// Conservative connectivity audit of observed native copper; this never plans a route.
import {segmentsIntersect} from './board-geometry.mjs';
import {fingerprint} from './drawing.mjs';
const finite=Number.isFinite;
const distance=(p,a,b)=>{const dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy,t=d?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/d)):0;return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);};
export function auditCopper(doc,native){
 const issues=[],nodes=[];
 if(doc.status!=='ok'||doc.truncated!==false||doc.components.length!==doc.counts?.components||native.status!=='ok')return {status:'unknown',issues:[{code:'COPPER_OBSERVATION_INCOMPLETE'}],fullyConnected:false};
 for(const c of doc.components)for(const p of c.pins??[]){if(!p.net)continue;
  const shape=p.padShape,width=shape?.[1],height=shape?.[2];
  if(!['RECT','ELLIPSE','OVAL'].includes(shape?.[0])||![p.x,p.y,width,height].every(finite)||width<=0||height<=0||!([1,2].includes(p.layer)||p.layer===12&&p.metallization===true)){issues.push({code:'COPPER_PAD_GEOMETRY_OR_PLATING_UNVERIFIED',padId:p.id});continue;}
  // An inscribed circle is a deliberately conservative part of the actual pad.
  nodes.push({kind:'Pad',id:p.id,net:p.net,layers:p.layer===12?[1,2]:[p.layer],point:[p.x,p.y],radius:Math.min(width,height)/2,component:c.uniqueId,number:p.number});
 }
 for(const x of native.objects??[]){
  if(x.kind==='Line'&&[1,2].includes(x.layer)){if(!x.net||![x.startX,x.startY,x.endX,x.endY,x.lineWidth].every(finite)){issues.push({code:'COPPER_LINE_GEOMETRY_UNCERTAIN',id:x.primitiveId});continue;}nodes.push({kind:'Line',id:x.primitiveId,net:x.net,layers:[x.layer],a:[x.startX,x.startY],b:[x.endX,x.endY],radius:x.lineWidth/2});}
  else if(x.kind==='Via'){if(!x.net||![x.x,x.y,x.diameter].every(finite)||x.viaType!==0){issues.push({code:'COPPER_VIA_GEOMETRY_OR_TYPE_UNVERIFIED',id:x.primitiveId});continue;}nodes.push({kind:'Via',id:x.primitiveId,net:x.net,layers:[1,2],point:[x.x,x.y],radius:x.diameter/2});}
  else if((x.net&&['Arc','Polyline','Pour','Poured','Fill','Region'].includes(x.kind))||[1,2].includes(x.layer)&&x.kind!=='Line')issues.push({code:'COPPER_UNSUPPORTED_OBSERVED_SHAPE',id:x.primitiveId,kind:x.kind});
 }
 const parent=nodes.map((_,i)=>i),root=i=>parent[i]===i?i:(parent[i]=root(parent[i]));
 const touch=(a,b)=>a.a&&b.a?(segmentsIntersect(a.a,a.b,b.a,b.b)||Math.min(distance(a.a,b.a,b.b),distance(a.b,b.a,b.b),distance(b.a,a.a,a.b),distance(b.b,a.a,a.b))<=a.radius+b.radius+1e-7):a.a?distance(b.point,a.a,a.b)<=a.radius+b.radius+1e-7:b.a?distance(a.point,b.a,b.b)<=a.radius+b.radius+1e-7:Math.hypot(a.point[0]-b.point[0],a.point[1]-b.point[1])<=a.radius+b.radius+1e-7;
 for(let i=0;i<nodes.length;i++)for(let j=i+1;j<nodes.length;j++){const a=nodes[i],b=nodes[j];if(a.net===b.net&&a.layers.some(x=>b.layers.includes(x))&&touch(a,b))parent[root(j)]=root(i);}
 const nets=[];
 for(const net of [...new Set(nodes.filter(x=>x.kind==='Pad').map(x=>x.net))].sort()){
  const pads=nodes.map((x,i)=>({...x,index:i})).filter(x=>x.kind==='Pad'&&x.net===net),groups=new Map();for(const p of pads){const key=root(p.index);if(!groups.has(key))groups.set(key,[]);groups.get(key).push({id:p.id,component:p.component,number:p.number});}
  nets.push({net,pads:pads.length,connectedGroups:[...groups.values()],remainingConnections:Math.max(0,groups.size-1),copperObjects:nodes.filter(x=>x.net===net&&x.kind!=='Pad').length});
 }
 const remainingConnections=nets.reduce((s,x)=>s+x.remainingConnections,0);
 return {status:issues.length?'unknown':remainingConnections?'unconnected':'connected',fullyConnected:!issues.length&&remainingConnections===0,nets,remainingConnections,issues,method:'observed native line/via physical intersection graph; inscribed pad circles are conservative; native DRC remains required',sourceFingerprint:fingerprint({doc,native})};
}
