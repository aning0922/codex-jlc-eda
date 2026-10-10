/** Exact finite subset: axis-aligned native R (including circular corners), explicit closed L paths. */
export type Point=[number,number];
export type Segment={kind:'line';start:Point;end:Point}|{kind:'arc';start:Point;end:Point;center:Point;radius:number;sweepDegrees:number};
export type PathResult={state:'accepted'|'invalid'|'unverified';reason?:string;source:unknown;encoding?:string;closed?:boolean;closure?:string;segments?:Segment[];vertices?:Point[];signedAreaRaw2?:number;areaRaw2?:number;direction?:string;bounds?:{minX:number;minY:number;maxX:number;maxY:number};rect?:{x:number;y:number;width:number;height:number;radius:number}};
const finite=(v:unknown):v is number=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=1e8;
const eq=(a:Point,b:Point)=>a[0]===b[0]&&a[1]===b[1];
const cross=(a:Point,b:Point,c:Point)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
const on=(a:Point,b:Point,p:Point)=>cross(a,b,p)===0&&p[0]>=Math.min(a[0],b[0])&&p[0]<=Math.max(a[0],b[0])&&p[1]>=Math.min(a[1],b[1])&&p[1]<=Math.max(a[1],b[1]);
export function segmentsIntersect(a:Point,b:Point,c:Point,d:Point){const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),x=cross(c,d,b);return ((u>0&&v<0||u<0&&v>0)&&(w>0&&x<0||w<0&&x>0))||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b);}
export function parseBoardPath(source:unknown):PathResult{
 const fail=(state:'invalid'|'unverified',reason:string):PathResult=>({state,reason,source});
 if(!Array.isArray(source)||!source.length)return fail('invalid','missing_or_malformed_path');
 if(source.length>4096)return fail('unverified','path_limit_exceeded');
 if(source[0]==='R'){
  if(source.length!==7||!source.slice(1).every(finite))return fail('invalid','invalid_rectangle_tuple');
  const [,x,y,w,h,rotation,r]=source as [string,number,number,number,number,number,number];
  if(w<=0||h<=0)return fail('invalid','degenerate_area');
  if(rotation!==0)return fail('unverified','rotated_rectangle_unsupported');
  if(r<0||r>Math.min(w,h)/2)return fail('invalid','invalid_corner_radius');
  // R specifies top-left x/y, positive width to +X and height towards -Y.
  const vertices:Point[]=r===0?[[x,y],[x+w,y],[x+w,y-h],[x,y-h],[x,y]]:[[x+r,y],[x+w-r,y],[x+w,y-r],[x+w,y-h+r],[x+w-r,y-h],[x+r,y-h],[x,y-h+r],[x,y-r],[x+r,y]];
  const segments:Segment[]=[];
  if(r===0){for(let i=0;i<4;i++)segments.push({kind:'line',start:vertices[i],end:vertices[i+1]});}
  else{
   const centers:Point[]=[[x+w-r,y-r],[x+w-r,y-h+r],[x+r,y-h+r],[x+r,y-r]];
   for(let i=0;i<8;i++){
    if(i%2===0){if(!eq(vertices[i],vertices[i+1]))segments.push({kind:'line',start:vertices[i],end:vertices[i+1]});}
    else segments.push({kind:'arc',start:vertices[i],end:vertices[i+1],center:centers[(i-1)/2],radius:r,sweepDegrees:-90});
   }
  }
  const area=w*h-(4-Math.PI)*r*r;
  return {state:'accepted',source,encoding:'R',closed:true,closure:'intrinsically_closed_rectangle_primitive',segments,vertices,signedAreaRaw2:-area,areaRaw2:area,direction:'clockwise_in_numeric_XY',bounds:{minX:x,minY:y-h,maxX:x+w,maxY:y},rect:{x,y,width:w,height:h,radius:r}};
 }
 const values:any[]=[];
 if(source[2]!=='L')return fail('unverified','unsupported_curve_or_token:'+String(source[2]));
 for(let i=0;i<source.length;i++){
  const t=source[i];
  if(t==='L'){if(i<2||values.length%2||source[i-1]==='L'||!finite(source[i+1])||!finite(source[i+2]))return fail('invalid','invalid_line_command');continue;}
  if(typeof t==='string')return fail('unverified','unsupported_curve_or_token:'+t);
  if(!finite(t))return fail('invalid','nonfinite_or_invalid_coordinate');values.push(t);
 }
 if(values.length<8||values.length%2)return fail('invalid','insufficient_or_unpaired_coordinates');
 const vertices:Point[]=[];for(let i=0;i<values.length;i+=2)vertices.push([values[i],values[i+1]]);
 if(!eq(vertices[0],vertices.at(-1)!))return fail('invalid','open_path_gap_not_repaired');
 const count=vertices.length-1,seen=new Set<string>();
 for(let i=0;i<count;i++){
  const a=vertices[i],b=vertices[i+1];if(eq(a,b))return fail('invalid','zero_length_edge');
  const key=[JSON.stringify(a),JSON.stringify(b)].sort().join('|');if(seen.has(key))return fail('invalid','duplicate_edge');seen.add(key);
 }
 for(let i=0;i<count;i++)for(let j=i+1;j<count;j++){
  if(j===i+1||i===0&&j===count-1){
   const a=vertices[i],b=vertices[i+1],other=j===i+1?vertices[j+1]:vertices[j];
   if(cross(a,b,other)===0&&on(a,b,other))return fail('invalid','overlapping_adjacent_edges');continue;
  }
  if(segmentsIntersect(vertices[i],vertices[i+1],vertices[j],vertices[j+1]))return fail('invalid','self_intersection_or_touch');
 }
 let signed=0;for(let i=0;i<count;i++)signed+=vertices[i][0]*vertices[i+1][1]-vertices[i+1][0]*vertices[i][1];signed/=2;
 if(signed===0||!Number.isFinite(signed))return fail('invalid','degenerate_area');
 return {state:'accepted',source,encoding:'explicit_line_path',closed:true,closure:'exact_serialized_endpoint_equality',vertices,segments:vertices.slice(0,-1).map((p,i)=>({kind:'line',start:p,end:vertices[i+1]})),signedAreaRaw2:signed,areaRaw2:Math.abs(signed),direction:signed>0?'counterclockwise_in_numeric_XY':'clockwise_in_numeric_XY',bounds:{minX:Math.min(...vertices.map(p=>p[0])),minY:Math.min(...vertices.map(p=>p[1])),maxX:Math.max(...vertices.map(p=>p[0])),maxY:Math.max(...vertices.map(p=>p[1]))}};
}
export function pointInBoardPath(p:Point,path:PathResult):'inside'|'outside'|'boundary'|'unverified'{
 if(path.state!=='accepted'||!path.bounds)return 'unverified';
 if(path.rect){const {x,y,width:w,height:h,radius:r}=path.rect;
  if(p[0]<x||p[0]>x+w||p[1]<y-h||p[1]>y)return 'outside';
  const cx=Math.max(x+r,Math.min(x+w-r,p[0])),cy=Math.max(y-h+r,Math.min(y-r,p[1]));
  const d=(p[0]-cx)**2+(p[1]-cy)**2;
  if(r&&d>r*r)return 'outside';if(p[0]===x||p[0]===x+w||p[1]===y||p[1]===y-h||r>0&&d===r*r)return 'boundary';return 'inside';
 }
 const v=path.vertices!;let inside=false;
 for(let i=0;i<v.length-1;i++){const a=v[i],b=v[i+1];if(on(a,b,p))return 'boundary';if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}
 return inside?'inside':'outside';
}
/** Ring nesting is a geometry observation, never proof of a native cutout. */
export function ringRelations(paths:PathResult[]){
 const relations:any[]=[];
 for(let i=0;i<paths.length;i++)for(let j=i+1;j<paths.length;j++){
  const a=paths[i],b=paths[j];let state='unverified';
  if(a.state==='accepted'&&b.state==='accepted'){
   const as=a.segments!,bs=b.segments!;
   if(as.every(s=>s.kind==='line')&&bs.every(s=>s.kind==='line')){
    state=as.some(s=>bs.some(t=>segmentsIntersect(s.start,s.end,t.start,t.end)))?'touching_or_crossing':pointInBoardPath(b.vertices![0],a)==='inside'?'b_inside_a':pointInBoardPath(a.vertices![0],b)==='inside'?'a_inside_b':'disjoint_multiple_outer';
   }else if(a.bounds!.maxX<b.bounds!.minX||b.bounds!.maxX<a.bounds!.minX||a.bounds!.maxY<b.bounds!.minY||b.bounds!.maxY<a.bounds!.minY)state='disjoint_multiple_outer';
  }
  relations.push({a:i,b:j,state,cutoutSemantic:'unverified'});
 }
 return relations;
}
