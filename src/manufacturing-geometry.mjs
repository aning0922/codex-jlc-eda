import{boundPasteWindows}from'./manufacturing-stencil.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
const mm=x=>x*.0254,rad=x=>x*Math.PI/180;
export const distanceSegment=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/l)):0;return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
export function signedDistance(s,p){
 if(s.kind==='circle')return Math.hypot(p.x-s.x,p.y-s.y)-s.r;
 if(s.kind==='rect'){const dx=Math.abs(p.x-s.x)-s.w/2,dy=Math.abs(p.y-s.y)-s.h/2;return Math.hypot(Math.max(dx,0),Math.max(dy,0))+Math.min(Math.max(dx,dy),0);}
 if(s.kind==='capsule')return distanceSegment(p,s.a,s.b)-s.r;
 if(s.kind==='union')return Math.min(...s.shapes.map(x=>signedDistance(x,p)));
 if(s.kind==='polygon'){let inside=false,d=Infinity;for(let i=0,k=s.points.length-1;i<s.points.length;k=i++){const a=s.points[i],b=s.points[k];d=Math.min(d,distanceSegment(p,a,b));if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)inside=!inside;}return inside?-d:d;}
 throw Error('CAM_GEOMETRY_UNSUPPORTED');
}
const rotate=(p,angle)=>({x:p.x*Math.cos(angle)-p.y*Math.sin(angle),y:p.x*Math.sin(angle)+p.y*Math.cos(angle)});
function flashShape(tool,macros,p){
 const [w,h]=tool.params;if(tool.hole?.length)throw Error('CAM_APERTURE_HOLE_UNSUPPORTED');
 if(tool.shape==='circle')return {kind:'circle',...p,r:w/2};
 if(tool.shape==='rect')return {kind:'rect',...p,w,h};
 if(tool.shape==='obround'){const r=Math.min(w,h)/2,a={x:p.x-(w>h?(w-h)/2:0),y:p.y-(h>w?(h-w)/2:0)},b={x:2*p.x-a.x,y:2*p.y-a.y};return {kind:'capsule',a,b,r};}
 const macro=macros.get(tool.shape);if(!macro)throw Error('CAM_MACRO_MISSING');let mods=Object.fromEntries(tool.params.map((x,i)=>['$'+(i+1),x])),shapes=[];
 for(const block of macro.blocks){if(block.type==='variable'){mods=block.set(mods);continue;}if(block.type==='comment')continue;const b=Object.fromEntries(Object.entries(block).map(([k,v])=>[k,typeof v==='function'?v(mods):Array.isArray(v)?v.map(q=>typeof q==='function'?q(mods):q):v]));if(b.exp!==1||b.rot!==0)throw Error('CAM_MACRO_POLARITY_OR_ROTATION_UNSUPPORTED');
  if(b.type==='circle')shapes.push({kind:'circle',x:p.x+b.cx,y:p.y+b.cy,r:b.dia/2});
  else if(b.type==='vect'){const l=Math.hypot(b.x2-b.x1,b.y2-b.y1);if(!l)throw Error('CAM_ZERO_MACRO_VECTOR');const dx=-(b.y2-b.y1)/l*b.width/2,dy=(b.x2-b.x1)/l*b.width/2;shapes.push({kind:'polygon',points:[[b.x1+dx,b.y1+dy],[b.x2+dx,b.y2+dy],[b.x2-dx,b.y2-dy],[b.x1-dx,b.y1-dy]].map(([x,y])=>({x:p.x+x,y:p.y+y}))});}
  else if(b.type==='outline')shapes.push({kind:'polygon',points:b.points.filter((_,i)=>i%2===0).map((x,i)=>({x:p.x+x,y:p.y+b.points[i*2+1]}))});
  else throw Error('CAM_MACRO_PRIMITIVE_UNSUPPORTED');
 }
 if(JSON.stringify(shapes).includes('null'))throw Error('CAM_MACRO_NONFINITE');return {kind:'union',shapes};
}
export function camGeometry(parsed){
 const tools=new Map(),macros=new Map(),shapes=[],unsupported=[];let tool,region=false,points=[],pos={x:0,y:0},mode='i';
 for(const c of parsed.commands){try{
  if(c.type==='tool')tools.set(c.code,c.tool);if(c.type==='macro')macros.set(c.name,c);
  if(c.type==='level'&&(c.level!=='polarity'||c.value!=='D'))throw Error('CAM_CLEAR_OR_REPEAT_UNSUPPORTED');
  if(c.type==='set'){if(c.prop==='tool')tool=tools.get(c.value);if(c.prop==='mode')mode=c.value;if(c.prop==='nota'&&c.value!=='A')throw Error('CAM_INCREMENTAL_UNSUPPORTED');if(c.prop==='region'){if(region&&!c.value&&points.length){shapes.push({kind:'polygon',points});points=[];}region=c.value;}}
  if(c.type==='op'){const next={x:c.coord.x??pos.x,y:c.coord.y??pos.y};if(c.op==='flash')shapes.push({...flashShape(tool,macros,next),line:c.line,anchor:next,tool});else if(region){if(c.op==='move'){if(points.length)throw Error('CAM_REGION_MULTICONTOUR_UNSUPPORTED');points=[next];}else if(c.op==='int'&&mode==='i')points.push(next);else throw Error('CAM_REGION_ARC_UNSUPPORTED');}else if(c.op==='int'){if(mode!=='i'||tool?.shape!=='circle')throw Error('CAM_STROKE_UNSUPPORTED');shapes.push({kind:'capsule',a:pos,b:next,r:tool.params[0]/2,line:c.line});}pos=next;}
 }catch(e){unsupported.push({line:c.line,code:e.message});}}
 if(region)unsupported.push({code:'CAM_REGION_UNCLOSED'});
 return {shapes,unsupported,complete:!unsupported.length};
}
export function sourceCatalog(data,document){
 const docs=nativeModelRecords(data),pcb=docs.get(document.documentUuid),origin=pcb.rows.filter(r=>r.type==='CANVAS');if(origin.length!==1||origin[0].body.originX!==0||origin[0].body.originY!==0)throw Error('MANUFACTURE_ZERO_ORIGIN_REQUIRED');
 const pads=[],vias=[],components=[];if(pcb.rows.filter(r=>r.type==='COMPONENT').length!==document.components.length)throw Error('MANUFACTURE_COMPONENT_SET_MISMATCH');
 const addVia=(v,p,id,ref=null)=>vias.push({id,component:ref,net:v.netName,x:mm(p.x),y:mm(p.y),diameter:mm(v.viaDiameter),hole:mm(v.holeDiameter),source:v});
 for(const row of pcb.rows.filter(r=>r.type==='VIA'))addVia(row.body,{x:row.body.centerX,y:row.body.centerY},row.id);
 for(const c of document.components){const ins=pcb.rows.filter(r=>r.type==='COMPONENT'&&r.id===c.id),binding=pcb.rows.filter(r=>r.type==='ATTR'&&r.body.parentId===c.id&&r.body.key==='Footprint'),model=docs.get(c.footprint?.uuid);if(ins.length!==1||binding.length!==1||binding[0].body.value!==model?.uuid||model.docType!=='FOOTPRINT'||model.rows.filter(r=>r.type==='META'&&r.body.source).length!==1||ins[0].body.layerId!==1||c.layer!==1)throw Error('MANUFACTURE_TOP_BOUND_MODEL_REQUIRED');
  const b=ins[0].body;if(Math.abs(b.x-c.x)>.0001||Math.abs(b.y-c.y)>.0001||Math.abs(((b.angle-c.rotation+540)%360)-180)>1e-8||b.attrs?.['Unique ID']!==c.uniqueId)throw Error('MANUFACTURE_INSTANCE_CHANGED');const canvas=model.rows.filter(r=>r.type==='CANVAS');if(canvas.length!==1||canvas[0].body.originX!==0||canvas[0].body.originY!==0)throw Error('MANUFACTURE_MODEL_ORIGIN_UNSUPPORTED');const a=rad(b.angle),transform=q=>{const t=rotate(q,a);return {x:b.x+t.x,y:b.y+t.y};};components.push({ref:c.designator,id:c.id,x:mm(b.x),y:mm(b.y),angle:b.angle});
  const rawPads=model.rows.filter(r=>r.type==='PAD');if(rawPads.some(r=>r.body.hole&&r.body.hole.holeType!=='ROUND'))throw Error('MANUFACTURE_ROUND_HOLES_REQUIRED');if(rawPads.some(r=>r.body.specialPad?.length)||rawPads.some(r=>!['RECT','OVAL','ELLIPSE'].includes(r.body.defaultPad?.padType)))throw Error('MANUFACTURE_PAD_SHAPE_UNSUPPORTED');if(rawPads.length!==c.pins.length)throw Error('MANUFACTURE_PAD_MODEL_COUNT');
  for(const r of rawPads){const s=r.body,p=c.pins.find(p=>p.id===c.id+r.id),net=pcb.rows.filter(q=>q.type==='PAD_NET'&&q.id===JSON.stringify(['PAD_NET',c.id,s.num,r.id]));if(!p||net.length!==1||net[0].body.padNet!==(p.net??'')||String(p.number)!==String(s.num))throw Error('MANUFACTURE_PAD_BINDING_MISMATCH');const pos=transform({x:s.centerX,y:s.centerY});const offset=rotate({x:s.padOffsetX??0,y:s.padOffsetY??0},rad(s.padAngle));const holePos=transform({x:s.centerX+offset.x,y:s.centerY+offset.y});pads.push({id:p.id,ref:c.designator,number:s.num,net:p.net,x:mm(pos.x),y:mm(pos.y),source:s,customPaste:boundPasteWindows(model,s,transform),layer:s.layerId,holeX:mm(holePos.x),holeY:mm(holePos.y),hole:s.hole?mm(Math.max(s.hole.width,s.hole.height)):0});}
  for(const r of model.rows.filter(r=>r.type==='VIA')){const v=r.body,pos=transform({x:v.centerX,y:v.centerY}),net=pcb.rows.filter(q=>q.type==='PAD_NET'&&q.id===JSON.stringify(['PAD_NET',c.id,r.id,r.id]));if(net.length!==1)throw Error('MANUFACTURE_OWNED_VIA_NET');addVia({...v,netName:net[0].body.padNet},pos,c.id+r.id,c.designator);}
 }
 return {pads,vias,components,origin:origin[0].body};
}
export function evaluateVias(catalog,cam){
 const dist=(g,p)=>g.complete?Math.min(...g.shapes.map(s=>signedDistance(s,p))):null;
 return catalog.vias.map(v=>{
  const neighbours=catalog.pads.map(p=>{const shapes=cam.copper.shapes.filter(s=>s.anchor&&Math.hypot(s.anchor.x-p.x,s.anchor.y-p.y)<.000008);const copperDistance=shapes.length===1?signedDistance(shapes[0],v):null;return {padId:p.id,ref:p.ref,number:p.number,net:p.net,copperBoundaryDistance:copperDistance,holeToCopper:copperDistance===null?null:copperDistance-v.hole/2,annulusToCopper:copperDistance===null?null:copperDistance-v.diameter/2};}).filter(p=>p.annulusToCopper!==null&&p.annulusToCopper<.2).sort((a,b)=>a.holeToCopper-b.holeToCopper);
  const pasteDistance=dist(cam.paste,v),maskDistance=dist(cam.mask,v);return {...v,source:undefined,neighbours,pasteBoundaryDistance:pasteDistance,holeToPaste:pasteDistance===null?null:pasteDistance-v.hole/2,maskBoundaryDistance:maskDistance,holeToMask:maskDistance===null?null:maskDistance-v.hole/2,annulusToMask:maskDistance===null?null:maskDistance-v.diameter/2,pasteOverlapsHole:pasteDistance!==null&&pasteDistance<v.hole/2,maskOpensHole:maskDistance!==null&&maskDistance<v.hole/2,holeInsideCopper:neighbours.some(p=>p.copperBoundaryDistance<=-v.hole/2),holeIntersectsCopper:neighbours.some(p=>p.holeToCopper<0)};
 });
}
