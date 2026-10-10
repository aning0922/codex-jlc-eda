import{parseNativeSource}from'./native-records.mjs';
import {unzipSync,strFromU8} from 'fflate';import {fingerprint} from './drawing.mjs';import {equivalentAngle} from './angles.mjs';import {isOwnedFootprintVia} from './footprint-vias.mjs';
const fail=code=>{throw Object.assign(Error(code),{code,status:'unknown'});},near=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=.0001;
export function nativeModelRecords(data){
 const docs=new Map();for(const [file,bytes]of Object.entries(unzipSync(Buffer.from(data,'base64'))))if(file.endsWith('.epru')){let doc;for(const {header:h,body,deleted}of parseNativeSource(strFromU8(bytes))){if(h.type==='DOCHEAD'){doc={uuid:body.uuid,docType:body.docType,rows:[],tombstones:[]};if(docs.has(doc.uuid))fail('FILE_MODEL_DOCUMENT_AMBIGUOUS');docs.set(doc.uuid,doc);}else{if(!doc)fail('FILE_MODEL_RECORD_UNBOUND');(deleted?doc.tombstones:doc.rows).push({type:h.type,id:h.id??null,body});}}}
 return docs;
}
const one=(rows,predicate,code)=>{const found=rows.filter(predicate);if(found.length!==1)fail(code);return found[0];};
function ownerBinding(docs,documentUuid,c){
 const pcb=docs.get(documentUuid),model=docs.get(c.footprint?.uuid);if(pcb?.docType!=='PCB'||model?.docType!=='FOOTPRINT')fail('FILE_FOOTPRINT_MODEL_MISSING');
 const instance=one(pcb.rows,r=>r.type==='COMPONENT'&&r.id===c.id,'FILE_FOOTPRINT_INSTANCE_AMBIGUOUS'),binding=one(pcb.rows,r=>r.type==='ATTR'&&r.body.parentId===c.id&&r.body.key==='Footprint','FILE_FOOTPRINT_BINDING_AMBIGUOUS'),meta=one(model.rows,r=>r.type==='META','FILE_FOOTPRINT_META_AMBIGUOUS'),canvas=one(model.rows,r=>r.type==='CANVAS','FILE_FOOTPRINT_CANVAS_AMBIGUOUS');
 if(binding.body.value!==model.uuid||!meta.body.source||canvas.body.originX!==0||canvas.body.originY!==0||c.layer!==1||instance.body.layerId!==1||instance.body.attrs?.['Unique ID']!==c.uniqueId||!near(instance.body.x,c.x)||!near(instance.body.y,c.y)||!equivalentAngle(instance.body.angle,c.rotation))fail('FILE_FOOTPRINT_INSTANCE_TRANSFORM_UNPROVEN');
 return {pcb,model,instance,binding,meta,canvas};
}
export function footprintPadEvidence(data,document){
 const docs=nativeModelRecords(data),rows=[];
 for(const c of document?.components??[])for(const p of c.pins??[])if(p.padShape?.[0]==='OVAL'){
  const owner=ownerBinding(docs,document.documentUuid,c),pad=one(owner.model.rows,r=>r.type==='PAD'&&c.id+r.id===p.id,'FILE_OVAL_SOURCE_PAD_AMBIGUOUS'),b=pad.body;
  if(b.defaultPad?.padType!=='OVAL'||b.layerId!==1||p.layer!==1||b.hole!==null||b.specialPad?.length||![b.defaultPad.width,b.defaultPad.height,b.padAngle,b.centerX,b.centerY,b.padOffsetX,b.padOffsetY].every(Number.isFinite)||b.defaultPad.width<=0||b.defaultPad.height<=0||!equivalentAngle(owner.instance.body.angle+b.padAngle,p.rotation)||Math.abs(b.defaultPad.width-p.padShape[1])>.051||Math.abs(b.defaultPad.height-p.padShape[2])>.051)fail('FILE_OVAL_NATIVE_SOURCE_UNSUPPORTED');
  const net=one(owner.pcb.rows,r=>r.type==='PAD_NET'&&r.id===JSON.stringify(['PAD_NET',c.id,b.num,pad.id]),'FILE_OVAL_PAD_NET_AMBIGUOUS');if(net.body.padNet!==(p.net??''))fail('FILE_OVAL_PAD_NET_CHANGED');
  rows.push({nativePadId:p.id,componentId:c.id,footprintUuid:owner.model.uuid,shape:['OVAL',b.defaultPad.width,b.defaultPad.height],rotation:p.rotation,sourcePad:pad,instance:owner.instance,binding:owner.binding,meta:owner.meta,canvasOrigin:{x:0,y:0},netAssignment:net});
 }
 rows.sort((a,b)=>a.nativePadId.localeCompare(b.nativePadId));
 return {documentUuid:document?.documentUuid,complete:true,rows,sha256:fingerprint(rows),coverage:'Current FOOTPRINT PAD, exact instance/Footprint ATTR/PAD_NET binding; top zero-origin OVAL only'};
}
function intrinsicOwnerPad(owner,c,via){
 const contacts=[];
 for(const source of owner.model.rows.filter(r=>r.type==='PAD')){
  const p=source.body,d=p.defaultPad;if(p.layerId!==1||p.hole!==null||p.specialPad?.length||!['RECT','OVAL','ELLIPSE'].includes(d?.padType)||![d.width,d.height,p.centerX,p.centerY,p.padOffsetX,p.padOffsetY].every(Number.isFinite)||d.width<=0||d.height<=0)continue;
  const net=owner.pcb.rows.filter(r=>r.type==='PAD_NET'&&r.id===JSON.stringify(['PAD_NET',c.id,p.num,source.id]));if(net.length!==1||net[0].body.padNet!==via.net)continue;
  const distance=Math.hypot(via.local.centerX-p.centerX-p.padOffsetX,via.local.centerY-p.centerY-p.padOffsetY),radius=Math.min(d.width,d.height)/2;
  if(distance<radius)contacts.push({proved:true,padId:c.id+source.id,padNumber:p.num,sourcePad:source,netAssignment:net[0],modelDistance:distance,inscribedRadius:radius,method:'Full native PAD geometry and exact network binding; via center lies inside conservative owner-pad circle, preserved through common exact instance transform'});
 }
 if(contacts.length!==1)fail('FILE_OWNED_VIA_INTRINSIC_CONTACT_UNPROVEN');return contacts[0];
}
export function ownedViaEvidence(data,native,document){
 const vias=(native?.objects??[]).filter(isOwnedFootprintVia);if(!vias.length)return [];
 if(native.footprintVias?.status!=='matched'||native.footprintVias.matchedCount!==vias.length)fail('FILE_OWNED_VIA_PROOF_INCOMPLETE');
 const docs=nativeModelRecords(data),rows=[];
 for(const v of vias){
  const o=v.componentOwnership,c=one(document?.components??[],x=>x.id===o.componentId&&x.uniqueId===o.uniqueId,'FILE_OWNED_VIA_OWNER_AMBIGUOUS'),owner=ownerBinding(docs,document.documentUuid,c),source=one(owner.model.rows,r=>r.type==='VIA'&&r.id===o.sourceViaId,'FILE_OWNED_VIA_MODEL_AMBIGUOUS'),b=source.body,net=one(owner.pcb.rows,r=>r.type==='PAD_NET'&&r.id===JSON.stringify(['PAD_NET',c.id,source.id,source.id]),'FILE_OWNED_VIA_NET_AMBIGUOUS'),angle=c.rotation*Math.PI/180;
  if(owner.model.uuid!==o.footprintUuid||owner.meta.body.source!==o.source||fingerprint({id:source.id,...b})!==o.modelViaFingerprint||net.body.padNet!==v.net||b.viaType!=='NORMAL'||v.viaType!==0||b.locked!==v.primitiveLock||!near(b.viaDiameter,v.diameter)||!near(b.holeDiameter,v.holeDiameter)||!near(c.x+b.centerX*Math.cos(angle)-b.centerY*Math.sin(angle),v.x)||!near(c.y+b.centerX*Math.sin(angle)+b.centerY*Math.cos(angle),v.y))fail('FILE_OWNED_VIA_SOURCE_MISMATCH');
  const intrinsicPadContact=intrinsicOwnerPad(owner,c,{net:v.net,local:b});
  rows.push({documentUuid:document.documentUuid,type:'FOOTPRINT_VIA',id:v.primitiveId,body:{footprintUuid:owner.model.uuid,modelVia:source,instance:owner.instance,footprintBinding:owner.binding,modelMeta:owner.meta,canvasOrigin:{x:0,y:0},netAssignment:net,intrinsicPadContact}});
 }
 return rows;
}
// Failed-stage disk diagnostics only. A missing tiny line must still exist in
// exact raw storage and its entire stroked segment must be contained in an
// unchanged, same-net/layer native pad. This never grants route/board success.
export function proveStoredPadContainedLines(data,document,lines){
 const docs=nativeModelRecords(data),proofs=[];
 for(const line of lines){const candidates=[];
  for(const c of document.components??[])for(const p of c.pins??[]){
   if(p.net!==line.net||p.layer!==line.layer)continue;
   const owner=ownerBinding(docs,document.documentUuid,c),pads=owner.model.rows.filter(r=>r.type==='PAD'&&c.id+r.id===p.id);if(pads.length!==1)continue;const source=pads[0],b=source.body,d=b.defaultPad;
   if(b.layerId!==1||p.layer!==1||b.hole!==null||b.specialPad?.length||!['RECT','OVAL','ELLIPSE'].includes(d?.padType)||d.padType!==p.padShape?.[0]||d.padType==='ELLIPSE'&&d.width!==d.height||![d.width,d.height,b.centerX,b.centerY,b.padOffsetX,b.padOffsetY,b.padAngle].every(Number.isFinite)||d.width<=0||d.height<=0||Math.abs(d.width-p.padShape[1])>.051||Math.abs(d.height-p.padShape[2])>.051||!equivalentAngle(owner.instance.body.angle+b.padAngle,p.rotation))continue;
   const net=owner.pcb.rows.filter(r=>r.type==='PAD_NET'&&r.id===JSON.stringify(['PAD_NET',c.id,b.num,source.id]));if(net.length!==1||net[0].body.padNet!==line.net)continue;
   const angle=owner.instance.body.angle*Math.PI/180,x=owner.instance.body.x+b.centerX*Math.cos(angle)-b.centerY*Math.sin(angle),y=owner.instance.body.y+b.centerX*Math.sin(angle)+b.centerY*Math.cos(angle);
   // Existing API pad-center nominal quantization only. Copper coordinates,
   // width, lock and source records themselves remain at their original gate.
   if(Math.abs(x-p.x)>.051||Math.abs(y-p.y)>.051)continue;
   const offsetBound=Math.hypot(b.padOffsetX,b.padOffsetY),radius=Math.min(d.width,d.height)/2-offsetBound,extent=Math.max(Math.hypot(line.startX-x,line.startY-y),Math.hypot(line.endX-x,line.endY-y))+line.lineWidth/2;
   if(extent<radius)candidates.push({lineId:line.primitiveId,padId:p.id,net:line.net,layer:line.layer,sourcePad:source,netAssignment:net[0],rawAnchor:[x,y],sourceOffsetMagnitude:offsetBound,inscribedRadius:radius,strokeExtent:extent,clearMargin:radius-extent});
  }
  if(candidates.length!==1)fail('FILE_STAGE_MISSING_LINE_PAD_CONTAINMENT_UNPROVEN');proofs.push(candidates[0]);
 }
 return {status:'matched',proofs,method:'Entire raw straight-line stroke lies inside a source-bound same-net/layer PAD circle conservatively shrunk by the full native pad-offset magnitude; full archive/copper records must separately match exactly',stagePreservationOnly:true};
}
