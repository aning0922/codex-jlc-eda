import {readDsn,readSes,circleStack,child,children,omitNodesPreservingBytes,fileSha,number} from './specctra.mjs';
import {fingerprint} from './drawing.mjs';
import {equivalentAngle} from './angles.mjs';import {isOwnedFootprintVia} from './footprint-vias.mjs';
const fail=m=>{throw Error(m);},rounded=x=>Math.round(x*100+1e-10)/100,eq=(x,y)=>Math.abs(x-y)<=1e-8;
function verifyPadShape(pin,native,dsn,nativePadEvidence){
 const stack=dsn.stacks.find(x=>x[1]===pin.padstack),shapes=children(stack,'shape').map(x=>{if(x.length!==2)fail('FILE_PAD_SHAPE_FORMAT');return x[1];}),layers=native.layer===12?dsn.layers:[dsn.layers[native.layer-1]];
 if(!layers[0]||shapes.length!==layers.length||shapes.some((x,i)=>x[1]!==layers[i]))fail('FILE_PAD_LAYER');
 const rotation=[0,90,180,270].find(x=>equivalentAngle(x,native.rotation));if(rotation===undefined||!['RECT','ELLIPSE','OVAL'].includes(native.padShape?.[0]))fail('FILE_PAD_NATIVE_SHAPE');
 if(native.padShape[0]==='OVAL'){
  if(nativePadEvidence?.complete!==true||fingerprint(nativePadEvidence.rows)!==nativePadEvidence.sha256)fail('FILE_OVAL_SOURCE_EVIDENCE_REQUIRED');
  const source=nativePadEvidence.rows.filter(x=>x.nativePadId===native.id);if(source.length!==1||!equivalentAngle(source[0].rotation,native.rotation))fail('FILE_OVAL_SOURCE_PAD_AMBIGUOUS');
  for(const shape of shapes)verifyOvalPolygon(shape,source[0].shape,rotation);
  return {kind:'OVAL',nativePadId:native.id,sourcePadFingerprint:fingerprint(source[0]),verticesVerified:22,method:'All ordered capsule vertices from exact native PAD dimensions, orthogonal rotation and native exporter two-decimal sampling; no bounding-box substitution'};
 }
 let width=native.padShape[1],height=native.padShape[2];if(rotation===90||rotation===270)[width,height]=[height,width];
 for(const shape of shapes){let w,h;if(shape[0]==='circle'){w=h=number(shape[2]);if(native.padShape[0]!=='ELLIPSE'||shape.length>3&&(number(shape[3])!==0||number(shape[4])!==0))fail('FILE_PAD_CIRCLE');}else if(shape[0]==='polygon'){const pts=shape.slice(3).map(number);if(native.padShape[0]!=='RECT'||pts.length<8||pts.length%2)fail('FILE_PAD_POLYGON');const xs=pts.filter((_,i)=>i%2===0),ys=pts.filter((_,i)=>i%2);w=Math.max(...xs)-Math.min(...xs);h=Math.max(...ys)-Math.min(...ys);if(Math.abs(Math.max(...xs)+Math.min(...xs))>1e-8||Math.abs(Math.max(...ys)+Math.min(...ys))>1e-8)fail('FILE_PAD_POLYGON_ORIGIN');
 const hx=w/2,hy=h/2;if(xs.some(x=>!eq(Math.abs(x),hx))||ys.some(y=>!eq(Math.abs(y),hy)))fail('FILE_PAD_POLYGON_NOT_RECT');}else fail('FILE_PAD_SHAPE_UNSUPPORTED');if(Math.abs(w-width)>.051||Math.abs(h-height)>.051)fail('FILE_PAD_SHAPE_MISMATCH');}
}
function verifyOvalPolygon(shape,nativeShape,rotation){
 if(shape[0]!=='polygon'||number(shape[2])!==.1||nativeShape[0]!=='OVAL')fail('FILE_OVAL_DSN_SHAPE_UNSUPPORTED');
 let w=nativeShape[1],h=nativeShape[2];if(rotation===90||rotation===270)[w,h]=[h,w];
 const radius=Math.min(w,h)/2,offset=Math.abs(w-h)/2,vertical=h>w,expected=[];
 if(!Number.isFinite(radius)||!Number.isFinite(offset)||radius<=0||offset<=0)fail('FILE_OVAL_NATIVE_DIMENSIONS');
 for(const sign of [1,-1])for(let j=0;j<=10;j++){
  const theta=sign===1?Math.PI-j*Math.PI/10:-j*Math.PI/10,across=radius*Math.cos(theta),along=sign*offset+radius*Math.sin(theta);
  expected.push((vertical?[across,along]:[along,across]).map(rounded));
 }
 const coords=shape.slice(3).map(number);if(coords.length%2)fail('FILE_OVAL_DSN_VERTICES');
 const points=[];for(let i=0;i<coords.length;i+=2){const q=[coords[i],coords[i+1]];if(!points.length||!q.every((n,j)=>eq(n,points.at(-1)[j])))points.push(q);}
 if(points.length>1&&points[0].every((n,j)=>eq(n,points.at(-1)[j])))points.pop();
 const matches=(a,b)=>a.every((n,j)=>eq(n,b[j]));
 if(points.length!==expected.length||!expected.some((_,start)=>[1,-1].some(direction=>points.every((q,i)=>matches(q,expected[(start+direction*i+expected.length*2)%expected.length])))))fail('FILE_OVAL_FULL_OUTLINE_MISMATCH');
}
export function validateDsnSource({dsnBytes,before,target,exportProof,nativePadEvidence,nativeCopperEvidence}){
 if(!target?.sessionId||!target.expectedProjectUuid||!target.pcbDocumentUuid||exportProof?.dsnSha256!==fileSha(dsnBytes)||exportProof?.beforeFingerprint!==fingerprint(before)||exportProof?.targetFingerprint!==fingerprint(target))fail('FILE_EXPORT_PROVENANCE');
 if(before.native.status!=='ok'||before.document.status!=='ok'||before.document.truncated||before.document.documentUuid!==target.pcbDocumentUuid||before.document.projectUuid!==target.expectedProjectUuid||before.native.layers!==2)fail('FILE_NATIVE_SOURCE');
 const dsn=readDsn(dsnBytes);
 const outlines=before.native.objects.filter(x=>x.layer===11),o=outlines[0],v=o?.polygon;
 if(outlines.length!==1||o.kind!=='Polyline'||!Array.isArray(v)||v[0]!=='R'||v[1]!==0||v[2]!==0||v[5]!==0||v[6]!==0||!eq(rounded(v[3]),dsn.extent.maxX)||!eq(rounded(v[4]),dsn.extent.maxY))fail('FILE_BOARD_TRANSFORM');
 // Explicitly observed flat, zero-origin export; no assumption about native ID mangling.
 const transform={units:'mil',resolution:1000,dsnOrigin:[0,0],nativeOrigin:[0,0],nativeBoardWidth:v[3],nativeBoardHeight:v[4],dsnHeight:dsn.extent.maxY,nativeToDsn:{x:'x',y:'y + exact native board height'},exporterHeight:v[4],importerOffsetDiagnostic:{dsnHeightMinusExactBoardHeight:dsn.extent.maxY-v[4]},nominalPadBoundMil:.051,keepToleranceUnchangedMil:.0001};
 const padMapping=[],padShapeProofs=[],claimed=new Set();for(const c of before.document.components)for(const p of c.pins){const found=dsn.pins.filter(q=>!claimed.has(q.id)&&q.net===(p.net??'')&&Math.abs(q.x-p.x)<=.051&&Math.abs(q.y-(p.y+dsn.extent.maxY))<=.051);if(found.length!==1)fail('FILE_PAD_MAPPING_AMBIGUOUS');const q=found[0];const shapeProof=verifyPadShape(q,p,dsn,nativePadEvidence);if(shapeProof)padShapeProofs.push(shapeProof);claimed.add(q.id);padMapping.push({componentId:c.id,nativePadId:p.id,dsnPadId:q.id,number:p.number,net:q.net,native:[p.x,p.y],dsn:[q.x,q.y],mappingMethod:'unique source-bound nominal center, shape/layers and net; no fixed ID rewrite'});}
 const nativeVias=before.native.objects.filter(x=>x.kind==='Via'),viaSource=[];
 if(dsn.vias.length!==nativeVias.length)fail('FILE_VIA_EXPORT_COVERAGE');
 for(const x of nativeVias){const owned=isOwnedFootprintVia(x);if(owned){const stored=nativeCopperEvidence?.rows?.filter(r=>r.id===x.primitiveId&&r.type==='FOOTPRINT_VIA')??[];if(before.native.footprintVias?.status!=='matched'||nativeCopperEvidence?.complete!==true||fingerprint(nativeCopperEvidence.rows)!==nativeCopperEvidence.sha256||nativeCopperEvidence.documentUuid!==target.pcbDocumentUuid||stored.length!==1||stored[0].body.modelVia.body.locked!==x.primitiveLock||stored[0].body.modelVia.body.holeDiameter!==x.holeDiameter||stored[0].body.netAssignment.body.padNet!==x.net)fail('FILE_OWNED_VIA_SOURCE_EVIDENCE_REQUIRED');}
  if(x.viaType!==0||!owned&&x.primitiveLock!==true||![x.x,x.y,x.diameter,x.holeDiameter].every(Number.isFinite)||x.holeDiameter<=0||x.diameter<=x.holeDiameter)fail('FILE_VIA_HOLE_OR_TYPE');
  const matched=dsn.vias.filter(q=>q.protect&&q.net===x.net&&eq(q.x,rounded(x.x))&&eq(q.y,rounded(x.y+transform.exporterHeight)));if(matched.length!==1)fail('FILE_VIA_DSN_AMBIGUOUS');const q=matched[0],stack=dsn.stacks.filter(z=>z[1]===q.stack);if(stack.length!==1||circleStack(stack[0],dsn.layers,1)!==x.diameter)fail('FILE_VIA_DSN_SIZE');
  const pins=dsn.pins.filter(p=>!claimed.has(p.id)&&p.net===x.net&&eq(p.x,q.x)&&eq(p.y,q.y));if(pins.length!==1)fail('FILE_VIA_PIN_AMBIGUOUS');claimed.add(pins[0].id);
  if(viaSource.some(z=>z.dsn.x===q.x&&z.dsn.y===q.y))fail('FILE_VIA_SOURCE_DUPLICATE');
  viaSource.push({nativeId:x.primitiveId,native:x,ownership:owned?'source_proven_footprint':'locked_independent',dsn:{stack:q.stack,x:q.x,y:q.y,net:q.net,protect:q.protect},extraPin:pins[0].id,holeSource:'actual official Via getState_HoleDiameter in export-before readback; no drill inferred from DSN',holeDiameterMil:x.holeDiameter,...(owned?{intrinsicPadContact:nativeCopperEvidence.rows.find(r=>r.id===x.primitiveId).body.intrinsicPadContact}:{} )});
 }
 if(claimed.size!==dsn.pins.length)fail('FILE_PAD_EXPORT_EXTRA');
 const nativeLines=before.native.objects.filter(x=>x.kind==='Line');if(dsn.wires.length!==nativeLines.length)fail('FILE_WIRE_EXPORT_COVERAGE');
 for(const x of nativeLines){const matched=dsn.wires.filter(w=>w.protect&&w.net===x.net&&w.layer===dsn.layers[x.layer-1]&&w.points.length===4&&eq(w.width,rounded(x.lineWidth))&&w.points.every((n,i)=>eq(n,rounded([x.startX,x.startY+transform.exporterHeight,x.endX,x.endY+transform.exporterHeight][i]))));if(x.primitiveLock!==true||matched.length!==1)fail('FILE_WIRE_EXPORT_MAPPING');}
 if(before.native.objects.some(x=>!['Line','Via','Polyline'].includes(x.kind)||x.kind==='Polyline'&&x.layer!==11))fail('FILE_NATIVE_PRIMITIVE_UNSUPPORTED');
 return {dsn,transform,padMapping,padShapeProofs,viaSource};
}
export function planSesImport(input){
 const {dsn,transform,padMapping,padShapeProofs,viaSource}=validateDsnSource(input),{sesBytes,before,target,expectedBaseDesign}=input,sesOptions={allowMissingEmptyNets:input.nativePadEvidence?.complete===true&&input.nativeCopperEvidence?.complete===true},ses=readSes(sesBytes,dsn,sesOptions);if(ses.baseDesign!==expectedBaseDesign)fail('FILE_BASE_DESIGN');
 const removed=[],removeNodes=new Set();for(const source of viaSource){const q=source.dsn,candidates=ses.vias.filter(z=>z.protect&&z.net===q.net&&z.stack===q.stack&&eq(z.x,q.x)&&eq(z.y,q.y));if(candidates.length!==1)fail('FILE_VIA_SES_AMBIGUOUS');const z=candidates[0],stack=ses.stacks.filter(s=>s[1]===z.stack);if(stack.length!==1||circleStack(stack[0],dsn.layers,1000)!==source.native.diameter)fail('FILE_VIA_SES_SIZE');
  if(ses.vias.some(other=>other!==z&&eq(other.x,z.x)&&eq(other.y,z.y)))fail('FILE_VIA_SES_DUPLICATE_OR_DIFFERENT');
  const endpoints=ses.wires.filter(w=>w.net===z.net&&w.points.some((n,i)=>i%2===0&&eq(n,z.x)&&eq(w.points[i+1],z.y)));const bothLayers=dsn.layers.every(layer=>endpoints.some(w=>w.layer===layer)),intrinsic=source.ownership==='source_proven_footprint'&&source.intrinsicPadContact?.proved===true;
  if(!bothLayers&&!intrinsic)fail('FILE_EXISTING_VIA_NO_TWO_LAYER_CONNECTION');
  removed.push({...source,ses:{net:z.net,stack:z.stack,x:z.x,y:z.y,protect:z.protect},action:'omit protect SES via record; original native via remains the layer connection',twoLayersCovered:true,externalBothLayersUsed:bothLayers,connectionBasis:bothLayers?'explicit SES trace endpoints on both copper layers':'source-owned normal through via, exact PAD_NET and intrinsic owner-pad contact; unused fixed via remains native'});removeNodes.add(z.node);
 }
 const omission=omitNodesPreservingBytes(sesBytes.toString(),ses.root,removeNodes),candidateBytes=omission.bytes,candidate=readSes(candidateBytes,dsn,sesOptions);
 return {status:'planned',policy:'strict_collinear_coverage',omittedEmptyNets:ses.omittedEmptyNets,emptyNetQualification:'Fixed SES writer emits net headers only for copper items; omitted source-empty nets remain unrouted and do not grant boardReady. Source pins/netlist and all keep/DRC/connectivity gates remain required',targetFingerprint:fingerprint(target),beforeFingerprint:fingerprint(before),dsnSha256:dsn.sha256,originalSesSha256:fileSha(sesBytes),candidateSesSha256:fileSha(candidateBytes),candidateBytes,omittedSourceRanges:omission.ranges,allOtherSourceBytesPreserved:omission.allOtherSourceBytesPreserved,transform,padMapping,padShapeProofs,removedViaRecords:removed,nativeViaCount:viaSource.length,originalSesVias:ses.vias.length,candidateSesVias:candidate.vias.length,sourceViaDrillPresentInDsn:false,qualification:'Bounded two-layer zero-origin flattened export only. Existing original via must remain exact after import; connectivity/DRC/keep/page/save still required.'};
}
