import {parseBoardPath,segmentsIntersect} from './board-geometry.mjs';
import {distanceSegment,signedDistance} from './manufacturing-geometry.mjs';

// Distances below are in mil. Keep the chord error smaller than the geometry readback tolerance used for contact.
export const surfaceTolerance=.005;
const sagitta=.002,finite=Number.isFinite;
const fail=()=>{throw Error('COPPER_CONTOUR_UNSUPPORTED');};
const asPoint=p=>({x:p[0],y:p[1]});
function contour(source,scale){
 if(!Array.isArray(source)||!source.length)fail();
 const points=[];
 const push=(x,y)=>{if(!finite(x)||!finite(y))fail();const last=points.at(-1);if(!last||Math.hypot(last.x-x,last.y-y)>1e-8)points.push({x,y});};
 function arc(cx,cy,r,start,sweep){
  const step=2*Math.acos(Math.max(-1,1-sagitta/r)),n=Math.max(2,Math.ceil(Math.abs(sweep)/step));if(!finite(n)||n>16384)fail();
  for(let i=1;i<=n;i++){const t=start+sweep*i/n;push(cx+r*Math.cos(t),cy+r*Math.sin(t));}
 }
 if(source[0]==='CIRCLE'&&source.length===4){
  const [,x,y,r]=source.map((v,i)=>i?v*scale:v);if(!(r>0))fail();push(x+r,y);arc(x,y,r,0,2*Math.PI);
 }else if(source[0]==='R'){
  const shape=parseBoardPath(source);if(shape.state!=='accepted')fail();
  for(const s of shape.segments){push(s.start[0]*scale,s.start[1]*scale);if(s.kind==='arc')arc(s.center[0]*scale,s.center[1]*scale,s.radius*scale,Math.atan2(s.start[1]-s.center[1],s.start[0]-s.center[0]),s.sweepDegrees*Math.PI/180);else push(s.end[0]*scale,s.end[1]*scale);}
 }else{
  if(!finite(source[0])||!finite(source[1]))fail();push(source[0]*scale,source[1]*scale);
  let mode;
  for(let i=2;i<source.length;){
   if(typeof source[i]==='string')mode=source[i++];
   if(mode==='L'){if(!finite(source[i])||!finite(source[i+1]))fail();push(source[i++]*scale,source[i++]*scale);continue;}
   if(mode!=='ARC'||!finite(source[i])||!finite(source[i+1])||!finite(source[i+2]))fail();
   const theta=source[i++]*Math.PI/180,x=source[i++]*scale,y=source[i++]*scale,a=points.at(-1),dx=x-a.x,dy=y-a.y;
   if(Math.abs(theta)<1e-8||Math.abs(theta)>=2*Math.PI||Math.hypot(dx,dy)<1e-8)fail();
   const h=1/(2*Math.tan(theta/2)),cx=(a.x+x)/2-dy*h,cy=(a.y+y)/2+dx*h;
   arc(cx,cy,Math.hypot(a.x-cx,a.y-cy),Math.atan2(a.y-cy,a.x-cx),theta);points[points.length-1]={x,y};
  }
 }
 if(points.length<4||Math.hypot(points[0].x-points.at(-1).x,points[0].y-points.at(-1).y)>surfaceTolerance)fail();
 points.pop();const area=Math.abs(points.reduce((s,p,i)=>{const q=points[(i+1)%points.length];return s+p.x*q.y-p.y*q.x;},0))/2;
 if(!(area>0))fail();return {kind:'polygon',area,points};
}
export function surfaceParts(source,scale=1){
 const paths=Array.isArray(source?.[0])?source:[source],rings=paths.map(s=>contour(s,scale)).sort((a,b)=>b.area-a.area);
 const parts=[],owners=new Map();
 for(let i=0;i<rings.length;i++){
  const ring=rings[i];let parent=null;
  for(let j=0;j<i;j++)if(signedDistance(rings[j],ring.points[0])<0)parent=rings[j];
  ring.depth=parent?parent.depth+1:0;
  if(ring.depth%2===0){const part={outer:ring,holes:[]};parts.push(part);owners.set(ring,part);}else owners.get(parent).holes.push(ring);
 }
 return parts;
}
export function surfaceDistance(s,p){return Math.max(signedDistance(s.outer,p),...s.holes.map(h=>-signedDistance(h,p)));}
export function surfaceSegmentDistance(s,a,b){
 const pa=asPoint(a),pb=asPoint(b),ends=Math.min(surfaceDistance(s,pa),surfaceDistance(s,pb));
 if(ends<=0)return ends;
 let min=ends;
 for(const ring of [s.outer,...s.holes])for(let j=0;j<ring.points.length;j++){
  const u=ring.points[j],v=ring.points[(j+1)%ring.points.length];
  if(segmentsIntersect(a,b,[u.x,u.y],[v.x,v.y]))return 0;
  min=Math.min(min,distanceSegment(u,pa,pb),distanceSegment(v,pa,pb));
 }
 return min;
}
export function provenPlanes(objects){
 const planes=objects.filter(o=>o.kind==='Pour'),filled=objects.filter(o=>o.kind==='Poured'),regions=[];
 for(const b of planes){
  const f=filled.filter(o=>o.pourPrimitiveId===b.primitiveId&&o.layer===b.layer);
  if(!b.net||b.pourFillMethod!=='solid'||b.preserveSilos!==false||f.length!==1||!f[0].pourFills?.length)fail();
  for(const [i,area] of f[0].pourFills.entries()){
   // 4.1.105 stores POURED paths in 10-mil coordinates, unlike the boundary.
   const base={net:b.net,layer:b.layer,boundaryId:b.primitiveId},id=b.primitiveId+'/'+i;
   if(area.fill===true&&area.lineWidth===0){
    for(const [j,surface] of surfaceParts(area.path,10).entries())regions.push({...base,kind:'Plane',id:id+'/'+j,surface});
   }else if(area.fill===false&&finite(area.lineWidth)&&area.lineWidth>0){
    const paths=Array.isArray(area.path?.[0])?area.path:[area.path];
    for(const [k,path] of paths.entries()){
     if(path?.[2]!=='L'||path.some(x=>x!=='L'&&!finite(x)))fail();
     const v=path.filter(x=>x!=='L');if(v.length<4||v.length%2)fail();
     for(let j=2;j<v.length;j+=2)regions.push({...base,kind:'PlaneStroke',id:id+'/'+k+'/'+j,a:[v[j-2]*10,v[j-1]*10],b:[v[j]*10,v[j+1]*10],radius:area.lineWidth*5});
    }
   }else fail();
  }
 }
 if(filled.some(f=>!planes.some(b=>b.primitiveId===f.pourPrimitiveId&&b.layer===f.layer)))fail();
 return regions;
}
