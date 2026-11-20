import {z} from 'zod';
import path from 'node:path';
import {readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import {readSchematicPng,pagePreviewPng} from './drawing.mjs';
export {pagePreviewPng} from './drawing.mjs';
import {circuitSchema,pageCircuitSchema,drawingScript,fingerprint,enrichModelSources} from './drawing.mjs';
import {bound,load,persist,action,closedWorkResult} from './workflow.mjs';
import {MAX_SCHEMATIC_PAGES, MAX_BOARD_COMPONENTS,digest} from './facts.mjs';
import {pcbSnapshot,comparePreservedPcbSnapshot,recordedPageIds} from './pcb.mjs';
import {capturePlacementArchives} from './placement-evidence.mjs';
import {archiveDesignFingerprint} from './resources.mjs';
import {readOwnedRouting,compareRoutingCheckpoint,routingScript} from './p3.mjs';
import {preserveArchive} from './eco-preservation.mjs';
import {unresolvedActions,verifyLayoutSnapshot} from './pcb-validation.mjs';
import {planLayout,toMil} from './layout.mjs';
import {compareNativeDrc} from './drc-comparison.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {oldSchematicLines,schematicProof,deferredPadEdits} from './unrouted-decoupling.mjs';
import {segmentsIntersect} from './board-geometry.mjs';
import {isOwnedFootprintVia} from './footprint-vias.mjs';
import {matchesFillRecord} from './copper-plane.mjs';
import {provenPlanes} from './copper-surface.mjs';
import {auditCopper} from './copper.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),coord=z.number().finite(),point=z.array(coord).length(2);
const sourcePinSchema=z.object({pageUuid:id,ref:id,pin:z.string().min(1).max(120),net:z.string().min(1).max(120),stubLength:coord.min(1).max(80).default(25),labelAt:point.optional()}).strict();
const sourceLabelSchema=z.object({pageUuid:id,wireId:id,net:z.string().min(1).max(120),from:point,to:point}).strict();
export const pageAdditionSchema=z.object({name:z.string().trim().min(1).max(80),circuit:pageCircuitSchema,sourcePins:z.array(sourcePinSchema).min(1).max(64).optional(),sourceLabels:z.array(sourceLabelSchema).min(1).max(480).optional(),placements:z.array(z.object({ref:id,xMm:coord,yMm:coord,layer:z.union([z.literal(1),z.literal(2)]).optional(),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])}).strict()).min(1).max(200)}).strict();
export const pageWiresSchema=z.array(z.object({net:z.string().min(1),lines:z.array(z.array(coord).length(4)).min(1).max(180),labelAt:point.optional()}).strict()).min(1).max(480);
const requireState=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'unknown'});};
export function appendSheetCircuit(before,input){
 const added=input.circuit,refs=new Set(added.components.map(c=>c.ref));
 requireState(!before.components.some(o=>refs.has(o.ref)||added.components.some(n=>n.designator===o.designator)),'SHEET_COMPONENT_ALREADY_EXISTS');
 requireState(input.placements.length===refs.size&&new Set(input.placements.map(p=>p.ref)).size===refs.size&&input.placements.every(p=>refs.has(p.ref)),'SHEET_PCB_PLACEMENTS_INCOMPLETE');
 const nets=structuredClone(before.nets);
 for(const n of added.nets){const old=nets.find(v=>v.name===n.name);if(old)old.endpoints.push(...n.endpoints);else nets.push(structuredClone(n));}
 const pending=new Set((before.openPins??[]).map(p=>p.ref+'.'+p.pin));
 for(const p of input.sourcePins??[]){
  requireState(pending.delete(p.ref+'.'+p.pin)&&added.nets.some(n=>n.name===p.net),'SHEET_SOURCE_PIN_NOT_DEFERRED_OR_NET_MISSING');
  nets.find(n=>n.name===p.net).endpoints.push({ref:p.ref,pin:p.pin,stubLength:p.stubLength});
 }
 const openPins=[...(before.openPins??[]).filter(p=>pending.has(p.ref+'.'+p.pin)),...(added.openPins??[])];
 return circuitSchema.parse({components:[...before.components,...added.components],nets,nc:[...before.nc,...added.nc],...(openPins.length?{openPins}:{}),notes:[...before.notes,...added.notes]});
}
async function readPage(a,t,uuid){
 const p={...t,schematicPageUuid:uuid};
 const doc=await a.jlc_eda_read_document({...p,kind:'schematic',documentUuid:uuid,includePins:true,includeGeometry:true,limit:200});
 requireState(doc.status==='ok'&&doc.truncated===false&&doc.documentUuid===uuid,'SHEET_DOCUMENT_UNVERIFIED');
 const raw=await a.invoke(t.sessionId,drawingScript({...p,operation:'archive'}));requireState(raw.status==='ok'&&raw.data,'SHEET_ARCHIVE_UNAVAILABLE');
 enrichModelSources(doc,raw.data);return {doc,data:raw.data,design:archiveDesignFingerprint(raw.data)};
}
async function nativeSheet(p){
 const info=async()=>{const project=await eda.dmt_Project.getCurrentProjectInfo(),board=project?.data?.filter(x=>x.itemType==='Board'&&x.pcb?.uuid===p.pcbDocumentUuid&&x.schematic?.uuid===p.schematicUuid);return project?.uuid===p.expectedProjectUuid&&board?.length===1?board[0].schematic.page:null;};
 const pages=await info(),prior=p.priorPages;
 if(!pages||!prior.some(x=>x.uuid===p.schematicPageUuid)||!prior.every(s=>pages.filter(x=>x.uuid===s.uuid&&(!s.name||x.name===s.name)).length===1))return {status:'failed',code:'SHEET_NATIVE_TARGET_CHANGED'};
 if(p.operation==='create'){
  if(pages.length!==prior.length||pages.some(x=>x.name===p.name))return {status:'failed',code:'SHEET_CREATION_PRECONDITION'};
  const uuid=await eda.dmt_Schematic.createSchematicPage(p.schematicUuid);
  return {status:typeof uuid==='string'?'ok':'unknown',uuid};
 }
 if(pages.length!==prior.length+1||prior.some(x=>x.uuid===p.newUuid)||!pages.some(x=>x.uuid===p.newUuid))return {status:'failed',code:'SHEET_PAIR_CHANGED'};
 if(p.operation==='rename'){
  const ok=await eda.dmt_Schematic.modifySchematicPageName(p.newUuid,p.name);
  return {status:ok===true?'ok':'unknown'};
 }
 const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();
 if(doc?.uuid!==p.pcbDocumentUuid||doc.parentProjectUuid!==p.expectedProjectUuid||doc.documentType!==3)return {status:'failed',code:'SHEET_PCB_FOCUS_CHANGED'};
 const parts=await eda.pcb_PrimitiveComponent.getAll(),ids=parts.map(x=>x.getState_PrimitiveId());
 if(new Set(ids).size!==ids.length||ids.length!==p.ids.length||!p.ids.every(x=>ids.includes(x)))return {status:'failed',code:'SHEET_PCB_INSTANCES_CHANGED'};
 if(p.operation==='sync'){
  const lines=(await eda.pcb_PrimitiveLine.getAll()).map(x=>[x.getState_PrimitiveId(),x.getState_Net(),x.getState_Layer(),x.getState_StartX(),x.getState_StartY(),x.getState_EndX(),x.getState_EndY(),x.getState_LineWidth()]);
  if(lines.length!==p.lines.length||!p.lines.every(row=>lines.some(x=>JSON.stringify(x)===JSON.stringify(row))))return {status:'failed',code:'SHEET_EXISTING_TRACES_CHANGED'};
  const value=await eda.pcb_Document.importChanges(p.schematicUuid,true);return {status:'ok',nativeResult:value??null};
 }
 if(p.operation==='place_pcb'){
  const poses=[];for(const v of p.poses){const part=await eda.pcb_PrimitiveComponent.get(v.id);
   if(!part||part.getState_UniqueId()!==v.ref||!(await info())?.some(x=>x.uuid===p.newUuid))return {status:'unknown',code:'SHEET_NEW_PART_CHANGED',poses};
   const moved=await eda.pcb_PrimitiveComponent.modify(v.id,{x:v.x,y:v.y,rotation:v.rotation,layer:v.layer??1,primitiveLock:false});if(!moved)return {status:'unknown',code:'SHEET_NEW_PART_MOVE_UNCONFIRMED',poses};poses.push(v.id);
  }return {status:'ok',poses};
 }
 return {status:'unsupported',code:'SHEET_UNKNOWN_OPERATION'};
}
const nativeCall=(a,t,stage,operation,extra={})=>a.invokeLossless(t.sessionId,'('+nativeSheet.toString()+')('+JSON.stringify({...t,operation,priorPages:stage.priorPages??[{uuid:t.schematicPageUuid}],name:stage.input.name,...extra})+')',60000);
const actionPrefix=stage=>stage.priorPages?'sheet/'+stage.uuid+'/':'added-page/';
async function pageTree(a,t){
 const project=await a.jlc_eda_inspect_project({sessionId:t.sessionId,expectedProjectUuid:t.expectedProjectUuid,waitForReady:true}),board=project.boards?.filter(b=>b.schematicUuid===t.schematicUuid&&b.pcbDocumentUuid===t.pcbDocumentUuid);
 requireState(project.status==='ok'&&project.project.uuid===t.expectedProjectUuid&&board?.length===1,'SHEET_BOARD_ASSOCIATION');
 return project.documents.filter(d=>d.itemType==='Schematic Page'&&d.parentSchematicUuid===t.schematicUuid&&board[0].schematicPageUuids.includes(d.uuid));
}
async function verifyPriorPages(a,t,stage){
 const pages=await pageTree(a,t),prior=stage.priorPages??[{uuid:t.schematicPageUuid}];
 requireState(pages.length===prior.length+(stage.uuid?1:0)&&prior.every(p=>pages.some(x=>x.uuid===p.uuid&&(!p.name||x.name===p.name)))&&(!stage.uuid||pages.some(x=>x.uuid===stage.uuid&&x.name===stage.input.name)),'SHEET_PARENT_PAGE_SET_CHANGED');
 for(const {uuid} of prior){
  const actual=await readPage(a,t,uuid);
  requireState(equal(actual.design,stage.sourcePinPages?.[uuid]??stage.before.schematicPages?.[uuid]??stage.before.schematic),'SHEET_ORIGINAL_SCHEMATIC_CHANGED');
 }
}
async function createAndPlace(a,ctx,t,stage){
 const {r,dir}=ctx;let pages=await pageTree(a,t);
 const prior=stage.priorPages??[{uuid:t.schematicPageUuid}];
 if(!stage.creation){
  await verifyPriorPages(a,t,stage);
  requireState(!pages.some(p=>p.name===stage.input.name),'SHEET_NAME_ALREADY_EXISTS');
  stage.creation={state:'pending'};await persist(dir,r);
  stage.creation.result=await nativeCall(a,t,stage,'create');await persist(dir,r);
 }
 pages=await pageTree(a,t);const fresh=pages.filter(x=>!prior.some(p=>p.uuid===x.uuid));
 requireState(pages.length===prior.length+1&&fresh.length===1&&stage.creation.result?.status==='ok'&&fresh[0].uuid===stage.creation.result.uuid&&(!stage.uuid||fresh[0].uuid===stage.uuid),'SHEET_CREATION_OUTCOME_UNCONFIRMED');
 stage.uuid=fresh[0].uuid;stage.creation.state='completed';await persist(dir,r);
 if(fresh[0].name!==stage.input.name){
  requireState(!stage.rename,'SHEET_RENAME_OUTCOME_UNCONFIRMED');stage.rename={state:'pending'};await persist(dir,r);
  stage.rename.result=await nativeCall(a,t,stage,'rename',{newUuid:stage.uuid});await persist(dir,r);
 }
 pages=await pageTree(a,t);requireState(pages.some(x=>x.uuid===stage.uuid&&x.name===stage.input.name),'SHEET_NAME_UNCONFIRMED');
 if(stage.rename)stage.rename.state='completed';await persist(dir,r);
 const target={...t,schematicPageUuid:stage.uuid};const before=await readPage(a,t,stage.uuid);
 if(!stage.blank){requireState(!before.doc.components.length&&!before.doc.counts.wires,'SHEET_NEW_PAGE_NOT_EMPTY');stage.blank=before.data;await persist(dir,r);}
 const parts=stage.input.circuit.components,prefix=actionPrefix(stage);
 if(!stage.placed&&Object.keys(r.actions??{}).some(k=>k.startsWith(prefix+'place/'))){
  for(const part of parts){
   const v=await action(a,target,ctx,prefix+'place/'+part.ref,{operation:'place',component:part});
   requireState(v.status==='ok',v.code??'SHEET_PART_UNCONFIRMED');
  }
 }else if(!stage.placed){
  for(let i=0;i<parts.length;i+=8){
   const components=parts.slice(i,i+8),v=await action(a,target,ctx,prefix+'placements/'+i,{operation:'sheet_place_batch',components});
   requireState(v.status==='ok'&&v.written?.length===components.length&&v.written.every((w,k)=>w.ref===components[k].ref&&w.primitiveId),'SHEET_BATCH_PLACEMENT_UNVERIFIED');
  }
 }
 const placed=await readPage(a,t,stage.uuid);requireState(placed.doc.components.length===stage.input.circuit.components.length,'SHEET_EXTRA_OR_MISSING_PARTS');
 for(const part of stage.input.circuit.components){
  const actual=placed.doc.components.filter(x=>x.uniqueId===part.ref&&x.designator===part.designator&&x.deviceSource?.uuid===part.deviceUuid&&x.deviceSource?.libraryUuid===part.libraryUuid&&x.footprintSource?.uuid===part.footprintUuid);
  requireState(actual.length===1&&Math.abs(actual[0].x-part.pose.x)<1e-6&&Math.abs(actual[0].y-part.pose.y)<1e-6&&actual[0].rotation===(360-part.pose.rotation)%360&&actual[0].mirror===part.pose.mirror,'SHEET_MODEL_OR_POSE_MISMATCH');
  const pins=[...stage.input.circuit.nets.flatMap(x=>x.endpoints),...stage.input.circuit.nc,...(stage.input.circuit.openPins??[])].filter(e=>e.ref===part.ref).map(e=>e.pin).sort();
  requireState(equal(pins,actual[0].pins.map(p=>p.number).sort()),'SHEET_NEW_PIN_COVERAGE');
 }
 stage.placed=true;await persist(dir,r);return {status:'ok',pageUuid:stage.uuid,document:placed.doc};
}
const onLine=([x,y],[x1,y1,x2,y2])=>(x1===x2&&Math.abs(x-x1)<1e-7||y1===y2&&Math.abs(y-y1)<1e-7)&&x>=Math.min(x1,x2)-1e-7&&x<=Math.max(x1,x2)+1e-7&&y>=Math.min(y1,y2)-1e-7&&y<=Math.max(y1,y2)+1e-7;
const ends=l=>[[l[0],l[1]],[l[2],l[3]]];
const meets=(l,m)=>ends(l).some(p=>onLine(p,m))||ends(m).some(p=>onLine(p,l));
export function sourcePinStubs(pins,doc,existing){
 const obstacles=[...existing],directions={0:[1,0],90:[0,1],180:[-1,0],270:[0,-1]};
 return pins.map(p=>{
  const parts=doc.components.filter(c=>c.uniqueId===p.ref);
  const members=parts.length===1?parts[0].pins.filter(x=>x.number===p.pin):[];
  const anchor=members[0],d=directions[anchor?.rotation];
  requireState(members.length===1&&d&&anchor.noConnected===false,'SHEET_SOURCE_PIN_IDENTITY');
  const {x,y,rotation}=anchor,end=[x+d[0]*p.stubLength,y+d[1]*p.stubLength],line=[x,y,...end];
  requireState(!obstacles.some(l=>segmentsIntersect([x,y],end,l.slice(0,2),l.slice(2)))&&
   !doc.components.some(c=>c.pins.some(q=>q!==anchor&&onLine([q.x,q.y],line))),'SHEET_SOURCE_STUB_COLLISION');
  obstacles.push(line);
  return {pin:p.pin,ref:p.ref,net:p.net,anchors:[{componentId:parts[0].id,pin:p.pin,x,y,rotation}],lines:[line],labelAt:p.labelAt??end};
 });
}
async function drawSourcePins(a,ctx,t,stage){
 for(const [uuid,plan] of Object.entries(stage.sourcePinPlans??{})){
  if(stage.sourcePinPages?.[uuid])continue;
  const target={...t,schematicPageUuid:uuid},page=await readPage(a,t,uuid),receipts=[];
  for(const s of plan.stubs){
   const key=actionPrefix(stage)+'source/'+s.ref+'/'+s.pin;
   const input={operation:'junction',net:s.net,anchors:s.anchors,lines:s.lines};
   const result=await action(a,target,ctx,key,input);requireState(result.status==='ok','SHEET_SOURCE_WIRE_UNCONFIRMED');
   receipts.push({input,result});
   const label=await action(a,target,ctx,key+'/label',{operation:'junction_label',net:s.net,wireId:result.wireId,labelAt:s.labelAt});
   requireState(label.status==='ok','SHEET_SOURCE_LABEL_UNCONFIRMED');
  }
  const fresh=await readPage(a,t,uuid),proof=schematicProof(plan.archive,fresh.data,target,page.doc.components,receipts,true);
  requireState(proof.status==='matched','SHEET_SOURCE_ARCHIVE_UNVERIFIED');
  (stage.sourcePinPages??={})[uuid]=fresh.design;plan.proof=proof;await persist(ctx.dir,ctx.r);
 }
}
export function sourceLabelEdits(rows,labels){
 const edits=labels.map(label=>{
  const matches=rows.filter(r=>r.type==='ATTR'&&r.body.parentId===label.wireId&&['Name','NET'].includes(r.body.key));
  const wire=rows.some(r=>r.type==='LINE'&&r.body.lineGroup===label.wireId),row=matches[0],b=row?.body;
  requireState(wire&&matches.length===1&&b.value===label.net&&b.valueVisible===true&&b.align==='CENTER_BOTTOM'&&b.rotation===0&&
   Math.abs(b.x-label.from[0])<.001&&Math.abs(b.y+label.from[1])<.001,'SHEET_LABEL_SOURCE_MISMATCH');
  return {type:'ATTR',id:row.id,before:b,after:{...b,x:label.to[0],y:-label.to[1]}};
 });
 requireState(new Set(edits.map(e=>e.id)).size===edits.length,'SHEET_DUPLICATE_SOURCE_LABEL');return edits;
}
async function moveSourceLabels(a,ctx,t,stage){
 for(const [uuid,group]of Object.entries(stage.labelPlans??{})){
  if(group.verified)continue;
  const target={...t,schematicPageUuid:uuid},labels=stage.input.sourceLabels.filter(l=>l.pageUuid===uuid);
  if(!group.started){
   const before=await readPage(a,t,uuid);
   requireState(equal(before.design,stage.sourcePinPages?.[uuid]??stage.before.schematicPages[uuid]),'SHEET_LABEL_SOURCE_CHANGED');
   group.archive=before.data;group.started=true;await persist(ctx.dir,ctx.r);
  }
  const edits=sourceLabelEdits(nativeModelRecords(group.archive).get(uuid).rows,labels);
  for(let i=0;i<labels.length;i+=12){
   const subset=labels.slice(i,i+12),v=await action(a,target,ctx,actionPrefix(stage)+'labels/'+uuid+'/'+i,{operation:'sheet_label_batch',labels:subset});
   requireState(v.status==='ok'&&v.written?.length===subset.length&&v.written.every((r,k)=>r.labelId===edits[i+k].id),'SHEET_LABEL_MOVE_UNVERIFIED');
  }
  const after=await readPage(a,t,uuid),proof=preserveArchive(group.archive,after.data,{mainUuid:uuid,edits});
  requireState(proof.status==='matched'&&proof.acceptedTargetEdits===edits.length,'SHEET_LABEL_ARCHIVE_MISMATCH');
  group.verified=proof;(stage.sourcePinPages??={})[uuid]=after.design;await persist(ctx.dir,ctx.r);
 }
}
export function sheetWirePlan(circuit,doc,wires){
 const pins=new Map(doc.components.flatMap(c=>c.pins.map(p=>[c.uniqueId+'.'+p.number,{...p,componentId:c.id}])));
 const nets=new Map(circuit.nets.flatMap(n=>n.endpoints.map(p=>[p.ref+'.'+p.pin,n.name])));
 const covered=new Set();
 const groups=wires.map((w,i)=>{
  requireState(circuit.nets.some(n=>n.name===w.net)&&w.lines.every(([x,y,u,v])=>(x===u)!==(y===v)),'SHEET_WIRE_GEOMETRY');
  const reached=new Set([0]);for(let n=1;n<w.lines.length;n++)for(let k=1;k<w.lines.length;k++)if([...reached].some(j=>meets(w.lines[j],w.lines[k])))reached.add(k);
  requireState(reached.size===w.lines.length,'SHEET_WIRE_DISCONNECTED');
  for(const earlier of wires.slice(0,i))if(earlier.net!==w.net)requireState(!earlier.lines.some(l=>w.lines.some(m=>meets(l,m))),'SHEET_DIFFERENT_NET_JUNCTION');
  const anchors=[];
  for(const [key,p]of pins)if(w.lines.some(l=>onLine([p.x,p.y],l))){
   requireState(nets.get(key)===w.net,'SHEET_WIRE_WRONG_PIN');
   covered.add(key);anchors.push({componentId:p.componentId,pin:p.number,x:p.x,y:p.y,rotation:p.rotation});
  }
  requireState(anchors.length,'SHEET_WIRE_WITHOUT_PIN');return {...w,anchors};
 });
 requireState(covered.size===nets.size&&[...nets.keys()].every(k=>covered.has(k)),'SHEET_WIRE_PIN_COVERAGE');
 return groups;
}
async function drawPage(a,ctx,t,stage,wires){
 requireState(stage.placed&&wires?.length,'SHEET_PLACE_AND_WIRES_REQUIRED');
 if(stage.wiresHash)requireState(stage.wiresHash===fingerprint(wires),'SHEET_WIRING_CONFLICT');
 const page=await readPage(a,t,stage.uuid),groups=sheetWirePlan(stage.input.circuit,page.doc,wires),target={...t,schematicPageUuid:stage.uuid};
 stage.wiresHash=fingerprint(wires);await persist(ctx.dir,ctx.r);
 const legacy=Object.keys(ctx.r.actions).some(k=>k.startsWith(actionPrefix(stage)+'wire/'));
 if(!legacy)for(let i=0;i<groups.length;i+=10){
  const chunk=groups.slice(i,i+10);
  const v=await action(a,target,ctx,actionPrefix(stage)+'wires/'+i,{operation:'sheet_wire_batch',groups:chunk});
  requireState(v.status==='ok'&&v.written.length===chunk.length&&v.written.every((row,k)=>row.net===chunk[k].net&&row.wire?.wireId&&(!chunk[k].labelAt||row.label?.labelId)),'SHEET_NEW_WIRE_BATCH_UNCONFIRMED');
 }
 if(legacy)for(const [i,g]of groups.entries()){
  const key=actionPrefix(stage)+'wire/'+i;
  const v=await action(a,target,ctx,key,{operation:'junction',net:g.net,anchors:g.anchors,lines:g.lines});requireState(v.status==='ok',v.code??'SHEET_WIRE_UNVERIFIED');
  if(g.labelAt){const l=await action(a,target,ctx,key+'/label',{operation:'junction_label',net:g.net,wireId:v.wireId,labelAt:g.labelAt});requireState(l.status==='ok',l.code??'SHEET_LABEL_UNVERIFIED');}
 }
 for(const pin of stage.input.circuit.nc){
  const part=stage.input.circuit.components.find(c=>c.ref===pin.ref);
  const v=await action(a,target,ctx,actionPrefix(stage)+'nc/'+pin.ref+'/'+pin.pin,{operation:'connect',endpoint:{...pin,designator:part.designator},nc:true});requireState(v.status==='ok',v.code??'SHEET_NC_UNVERIFIED');
 }
 for(const [i,note]of stage.input.circuit.notes.entries()){
  const v=await action(a,target,ctx,actionPrefix(stage)+'note/'+i,{operation:'note',note});requireState(v.status==='ok','SHEET_NOTE_UNVERIFIED');
 }
 await drawSourcePins(a,ctx,t,stage);
 await moveSourceLabels(a,ctx,t,stage);
 const result=await a.jlc_eda_verify_schematic({...t,pcbDocumentUuid:undefined,schematicPageUuids:recordedPageIds(ctx.r),circuit:stage.combined});
 if(result.status!=='ok'||result.comparison?.status!=='matched')return {...result,status:'unknown',code:'SHEET_COMBINED_NETLIST_UNVERIFIED'};
 await verifyPriorPages(a,t,stage);const fresh=await readPage(a,t,stage.uuid);
 requireState(fresh.doc.components.length===stage.input.circuit.components.length&&fresh.doc.components.every(c=>stage.input.circuit.components.some(n=>n.ref===c.uniqueId)),'SHEET_MEMBER_CHANGED');
 stage.verifiedSchematic=fresh.design;await persist(ctx.dir,ctx.r);
 return {status:'ok',pageUuid:stage.uuid,schematic:fresh.design,originalSchematic:stage.before.schematic,netlist:result.netlist,comparison:result.comparison};
}
async function readBoard(a,t){
 const doc=await a.jlc_eda_read_document({...t,kind:'pcb',documentUuid:t.pcbDocumentUuid,includePins:true,includeGeometry:true,limit:MAX_BOARD_COMPONENTS});
 requireState(doc.status==='ok'&&doc.truncated===false&&doc.counts.components===doc.components.length,'SHEET_PCB_DOCUMENT_UNVERIFIED');
 return doc;
}
function existingPcb(r,doc,native){
 const stage=r.continuation.selectedStage,old=stage.document,oldRefs=new Set(old.components.map(c=>c.uniqueId)),now=pcbSnapshot(doc);
 const original={...now,counts:{...now.counts,components:old.components.length},components:now.components.filter(c=>oldRefs.has(c.uniqueId))};
 const addedRefs=new Set(r.addedSheet.input.circuit.components.map(c=>c.ref));
 const footprintVias=native.objects.filter(v=>isOwnedFootprintVia(v)&&addedRefs.has(v.componentOwnership.uniqueId)&&
  doc.components.some(c=>c.uniqueId===v.componentOwnership.uniqueId&&c.id===v.componentOwnership.componentId&&c.footprint?.uuid===v.componentOwnership.footprintUuid));
 original.counts.viaObjects-=footprintVias.length;
 const expected=r.addedSheet?.sync&&r.addedSheet.input.sourcePins?structuredClone(old):old;
 if(expected!==old)for(const change of r.addedSheet.input.sourcePins){
  const part=expected.components.find(c=>c.uniqueId===change.ref),pads=part?.pins.filter(p=>p.number===change.pin);
  requireState(pads?.length===1&&pads[0].net==='','SHEET_SOURCE_PAD_NOT_OPEN');pads[0].net=change.net;
 }
 const parts=comparePreservedPcbSnapshot(expected,original,{expectedProjectUuid:stage.sourceProjectUuid,actualProjectUuid:doc.projectUuid});
 const additions=new Set(footprintVias.map(v=>v.primitiveId));
 const prior=o=>!additions.has(o.primitiveId)&&(!r.addedSheet.refill||o.kind!=='Poured');
 const copper=compareRoutingCheckpoint({...stage.native,objects:stage.native.objects.filter(prior)},{...native,objects:native.objects.filter(prior)});
 requireState(parts.status==='matched'&&copper.status==='matched','SHEET_PRIOR_PCB_OR_COPPER_CHANGED');
 return {parts,copper,footprintVias};
}
function fillRecordEdits(stage,t,source,native,fresh){
 if(!stage.refill)return [];
 const before=nativeModelRecords(stage.before.pcbData).get(t.pcbDocumentUuid),after=nativeModelRecords(fresh).get(t.pcbDocumentUuid);
 provenPlanes(native.objects);
 return source.objects.filter(o=>o.kind==='Poured').map(old=>{
  const current=native.objects.filter(o=>o.kind==='Poured'&&o.pourPrimitiveId===old.pourPrimitiveId&&o.layer===old.layer);
  const a=before.rows.filter(row=>matchesFillRecord(row,old)),b=after.rows.filter(row=>matchesFillRecord(row,current[0]));
  requireState(a.length===1&&b.length===1&&current.length===1&&a[0].id===b[0].id,'SHEET_REFILL_SOURCE_UNVERIFIED');
  return {type:'POURED',id:a[0].id,after:b[0].body};
 });
}
async function syncPage(a,ctx,t,stage,verifyOnly){
 requireState(stage.verifiedSchematic,'SHEET_VERIFIED_LOGIC_REQUIRED');
 const combined={...t,schematicPageUuids:recordedPageIds(ctx.r),circuit:stage.combined};
 if(!stage.sync){
  requireState(!verifyOnly,'SHEET_NO_PENDING_SYNC');
  const logic=await a.jlc_eda_verify_schematic({...combined,pcbDocumentUuid:undefined});requireState(logic.comparison?.status==='matched','SHEET_SYNC_LOGIC_CHANGED');
  await verifyPriorPages(a,t,stage);const fresh=await readPage(a,t,stage.uuid);
  requireState(equal(fresh.design,stage.verifiedSchematic),'SHEET_PREIMPORT_SCHEMATIC_CHANGED');
  const doc=await readBoard(a,t),native=await readOwnedRouting(a,t);existingPcb(ctx.r,doc,native);
  const before=await capturePlacementArchives(a,t);requireState(equal(before.pcb,stage.before.pcb)&&doc.components.length===ctx.r.continuation.selectedStage.document.components.length,'SHEET_PREIMPORT_PCB_CHANGED');
  const ids=doc.components.map(c=>c.id),lines=native.objects.filter(x=>x.kind==='Line').map(x=>[x.primitiveId,x.net,x.layer,x.startX,x.startY,x.endX,x.endY,x.lineWidth]);
  stage.sync={state:'pending'};await persist(ctx.dir,ctx.r);
  stage.sync.result=await nativeCall(a,t,stage,'sync',{newUuid:stage.uuid,ids,lines});await persist(ctx.dir,ctx.r);
 }
 const v=await a.jlc_eda_verify_pcb(combined);
 if(v.status!=='ok'||v.comparison?.status!=='matched')return {...v,status:'unknown',code:'SHEET_PCB_IMPORT_READBACK_REQUIRED',nativeMutationReplayed:false};
 const native=await readOwnedRouting(a,t),preserved=existingPcb(ctx.r,v.pcbDocument,native);
 const archived=await capturePlacementArchives(a,t),newParts=v.schematicVerification.documents.find(doc=>doc.documentUuid===stage.uuid).components;
 const ids=newParts.map(c=>v.pcbDocument.components.find(n=>n.uniqueId===c.uniqueId).id),models=newParts.flatMap(c=>[c.device?.uuid,c.symbol?.uuid,c.footprint?.uuid]).filter(Boolean);
 const oldNames=new Set(ctx.r.continuation.selectedStage.document.components.flatMap(c=>c.pins.map(p=>p.net)));
 const newNets=stage.combined.nets.filter(n=>!oldNames.has(n.name)).map(n=>JSON.stringify(['NET',n.name]));
 const report=preserveArchive(stage.before.pcbData,archived.pcbData,{mainUuid:t.pcbDocumentUuid,newIds:[...ids,...newNets],newParents:ids,allowNewModels:models,edits:stage.sourcePadEdits});
 if(report.status!=='matched')return {status:'unknown',code:'SHEET_PCB_ARCHIVE_DELTA_UNVERIFIED',report,ids,models};
 stage.sync.state='verified';stage.sync.proof=report;await persist(ctx.dir,ctx.r);
 return {status:'ok',pageUuid:stage.uuid,board:v.pcbDocument,comparison:v.comparison,preserved,archive:report};
}
function markerFields(marker){
 const {obj1,objs,pos,globalIndex,errorObjType,explanation,...common}=marker;
 const {obj1:primitive,obj1Type,obj1Suffix,position,layerIds,globalIndex:index,...rule}=explanation.errData;
 const {typeName,suffix,...objectFields}=obj1??{}, {x,y,...positionFields}=pos??{};
 return {...common,obj1:objectFields,pos:positionFields,explanation:{...explanation,errData:rule}};
}
export function sheetDrcDelta(before,after,addedParts,originalParts=[],sourcePins=[],copper){
 const newlyAssigned=sourcePins.flatMap(s=>(originalParts.find(c=>c.uniqueId===s.ref)?.pins??[]).filter(p=>p.number===s.pin&&p.net==='').map(p=>({...p,net:s.net})));
 requireState(newlyAssigned.length===sourcePins.length,'SHEET_DRC_SOURCE_PIN_BINDING');
 const pads=new Map([...addedParts.flatMap(c=>c.pins),...newlyAssigned].map(p=>[p.id,p])),remaining=structuredClone(after),added=[],previouslySinglePads=[];
 const extendedNets=new Set([...pads.values()].map(p=>p.net).filter(Boolean)),originalsByNet=new Map();
 for(const component of originalParts)for(const p of component.pins){
  if(!extendedNets.has(p.net))continue;
  const list=originalsByNet.get(p.net)??[];list.push({...p,designator:component.designator});originalsByNet.set(p.net,list);
 }
 const oldErrors=new Set(before.filter(g=>g.name==='Connection Error').flatMap(g=>g.list.map(n=>n.name)));
 const newRefs=new Set(addedParts.map(c=>c.uniqueId)),viaMarkers=[],oldGroupMarkers=[];
 const leaves=groups=>groups.filter(g=>g.name==='Connection Error').flatMap(g=>g.list.flatMap(n=>n.list));
 const oldLeaves=leaves(before),oldMarkerIds=new Set(oldLeaves.map(e=>e.explanation?.errData?.obj1));
 const currentIds=new Set(leaves(after).map(e=>e.explanation?.errData?.obj1));
 const displaced=oldLeaves.filter(e=>!currentIds.has(e.explanation?.errData?.obj1)),reassignedMarkers=[],redundantMarkers=[],substitutions=new Map();
 const sourceGraph=copper?auditCopper(copper.source.document,copper.source.native,{viaMembership:true}):null;
 const vias=new Map((copper?.native.objects??[]).filter(o=>o.kind==='Via').map(v=>[v.primitiveId,v]));
 const boundSourceGroup=e=>{
  const data=e.explanation?.errData,net=e.net,id=data?.obj1;
  if(!copper||sourceGraph.issues.length||copper.actual.issues.length||!extendedNets.has(net)||e.errorType!=='Connection Error'||data?.errorType!=='No Connection'||data.net!==net)return null;
  const pad=originalsByNet.get(net)?.find(p=>p.id===id),via=copper.source.native.objects.find(o=>o.kind==='Via'&&o.net===net&&o.primitiveId===id);
  const element=pad??via,type=via?'Via':pad?.layer===12?'TH Pad':'SMD Pad';
  if(!element||e.errorObjType!==type||data.obj1Type!==type||e.obj1?.typeName!==type||e.obj1.suffix!==data.obj1Suffix||
   !(pad?data.obj1Suffix==='('+net+'): '+pad.designator+'_'+pad.number:data.obj1Suffix?.startsWith('('+net+'): '))||
   !equal(data.layerIds,[via?12:pad.layer])||!equal(e.objs,[id])||!equal(e.pos,data.position)||
   !(Math.abs(data.position?.x*10-element.x)<.051&&Math.abs(data.position?.y*10-element.y)<.051))return null;
  const sourceId=via?sourceGraph.viaMembers[id]:id,actualId=via?copper.actual.viaMembers[id]:id;
  const old=sourceGraph.nets.find(n=>n.net===net)?.connectedGroups.find(g=>g.some(p=>p.id===sourceId));
  const groups=copper.actual.nets.find(n=>n.net===net)?.connectedGroups??[],present=groups.find(g=>g.some(p=>p.id===actualId));
  if(!old?.length||!present||!old.every(p=>present.some(q=>q.id===p.id)))return null;
  return {old,type,extra:groups.filter(g=>g.every(p=>pads.has(p.id))).length};
 };
 for(const group of remaining){
  if(group.name!=='Connection Error'||!Array.isArray(group.list))continue;
  for(const net of group.list){
   if(!Array.isArray(net.list))continue;
   const old=net.list.length,observedMarkers=net.list;
   net.list=net.list.filter(e=>{
    const obj=e.explanation?.errData;
    if(e.errorType!=='Connection Error'||obj?.errorType!=='No Connection'||!net.name||e.net!==net.name||obj.net!==net.name)return true;
    const p=pads.get(obj.obj1);
    if(p?.net===net.name){added.push({padId:p.id,net:p.net});return false;}
    const via=vias.get(obj.obj1);
    if(via?.net===net.name&&obj.obj1Type==='Via'&&e.obj1?.typeName==='Via'&&e.obj1.suffix===obj.obj1Suffix&&
       obj.obj1Suffix?.startsWith('('+via.net+'): ')&&equal(obj.layerIds,[12])&&equal(e.objs,[via.primitiveId])&&
       equal(obj.position,e.pos)&&Math.abs(obj.position?.x*10-via.x)<.051&&Math.abs(obj.position?.y*10-via.y)<.051){
     if(isOwnedFootprintVia(via)&&newRefs.has(via.componentOwnership.uniqueId)){viaMarkers.push({via:via.primitiveId,net:via.net});return false;}
    }
    if(copper&&!oldMarkerIds.has(obj.obj1)&&!oldGroupMarkers.some(m=>m.id===obj.obj1)&&extendedNets.has(net.name)){
     const bound=boundSourceGroup(e),oldGroup=bound?.old,extra=bound?.extra,kind=bound?.type;
     if(oldGroup&&extra){
      // The native DRC can choose a different representative of the same intact conductor.
      const index=displaced.findIndex(prior=>{
       const id=prior.explanation.errData.obj1,representative=sourceGraph.viaMembers[id]??id;
       return prior.net===net.name&&boundSourceGroup(prior)?.old===oldGroup&&oldGroup.some(p=>p.id===representative)&&equal(markerFields(prior),markerFields(e));
      });
      if(index>=0){
       const [prior]=displaced.splice(index,1);substitutions.set(e,prior);
       reassignedMarkers.push({net:net.name,before:prior.explanation.errData.obj1,after:obj.obj1,sourceGroupSize:oldGroup.length});
       return true;
      }
      if(oldGroupMarkers.filter(m=>m.net===net.name).length<extra){
       oldGroupMarkers.push({id:obj.obj1,type:kind,net:net.name,sourceGroupSize:oldGroup.length,newIsolatedGroups:extra});return false;
      }
     }
    }
    // A single existing pad first acquires a ratsnest when another pad joins its net.
    const prior=originalsByNet.get(net.name);
    if(prior?.length!==1||oldErrors.has(net.name)||previouslySinglePads.some(v=>v.net===net.name))return true;
    const pin=prior[0],suffix='('+pin.net+'): '+pin.designator+'_'+pin.number;
    if(obj.obj1!==pin.id||!equal(e.objs,[pin.id])||obj.obj1Suffix!==suffix||e.obj1?.suffix!==suffix||
       !equal(obj.layerIds,[pin.layer])||!Number.isFinite(obj.position?.x)||!Number.isFinite(obj.position?.y)||!equal(e.pos,obj.position)||
       Math.abs(obj.position.x*10-pin.x)>.051||Math.abs(obj.position.y*10-pin.y)>.051)return true;
    previouslySinglePads.push({padId:pin.id,designator:pin.designator,pin:pin.number,net:pin.net});return false;
   });
   net.list=net.list.map(e=>substitutions.get(e)??e);
   for(const prior of displaced.filter(e=>e.net===net.name)){
    const binding=boundSourceGroup(prior);
    if(!binding?.extra)continue;
    const witness=observedMarkers.find(e=>boundSourceGroup(e)?.old===binding.old&&equal(markerFields(e),markerFields(prior)));
    if(!witness)continue;
    // Multiple old markers can represent one conductor. At least one current witness must remain on that exact group.
    net.list.push(prior);redundantMarkers.push({net:net.name,before:prior.explanation.errData.obj1,witness:witness.explanation.errData.obj1,sourceGroupSize:binding.old.length});
   }
   if(net.list.length!==old){
    requireState(net.count===old&&net.title===net.name+' ('+old+')','SHEET_DRC_GROUP_COUNTS');
    net.count=net.list.length;net.title=net.name+' ('+net.count+')';
   }
  }
  const count=group.list.reduce((n,v)=>n+v.list.length,0);
  if(group.count!==count){requireState(equal(group.title,[group.name,'('+group.count+')']),'SHEET_DRC_CLASS_COUNT');group.count=count;group.title=[group.name,'('+count+')'];}
  group.list=group.list.filter(n=>n.list.length);
 }
 const comparison=compareNativeDrc(before,remaining.filter(g=>g.name!=='Connection Error'||g.list.length));
 return {status:comparison.status,comparison,addedDisconnectedPads:added,previouslySinglePads,viaMarkers,oldGroupMarkers,reassignedMarkers,redundantMarkers};
}
export function flipPadEvidence(pins){
 if(!pins?.length)return null;
 if(pins.every(p=>p.layer===1))return {kind:'surface'};
 if(!pins.every(p=>p.layer===12&&p.metallization===true&&p.hole?.[0]==='ROUND'&&p.hole[1]>0&&p.hole[1]===p.hole[2]))return null;
 return {kind:'through',pads:pins.map(({id,number,net,hole,padShape})=>({id,number,net,hole,padShape}))};
}
async function completePage(a,ctx,t,stage){
 const r=ctx.r;requireState(stage.sync?.state==='verified','SHEET_VERIFIED_SYNC_REQUIRED');
 if(stage.accepted)return {status:'ok',reused:true,accepted:stage.accepted};
 const baseline=r.pcbLayoutBaseline;let doc=await readBoard(a,t);const native=await readOwnedRouting(a,t);existingPcb(r,doc,native);
 const bottom=stage.input.placements.filter(p=>p.layer===2);let sideMutationRequested=false;
 if(bottom.length){
  if(!stage.sides){
   const move=bottom.map(p=>{
    const part=doc.components.find(c=>c.uniqueId===p.ref);
    const footprint=flipPadEvidence(part?.pins);
    requireState(part?.layer===1&&footprint&&!native.objects.some(o=>isOwnedFootprintVia(o)&&o.componentOwnership.componentId===part.id),'SHEET_SIDE_FOOTPRINT_UNVERIFIED');
    return {id:part.id,ref:p.ref,x:part.x,y:part.y,rotation:part.rotation,layer:2,footprint};
   });
   stage.sides={state:'pending',move};await persist(ctx.dir,r);
   sideMutationRequested=true;stage.sides.result=await nativeCall(a,t,stage,'place_pcb',{newUuid:stage.uuid,ids:doc.components.map(c=>c.id),poses:move});await persist(ctx.dir,r);
  }
  doc=await readBoard(a,t);
  requireState(stage.sides.result?.status==='ok'&&bottom.every(p=>{
   const part=doc.components.find(c=>c.uniqueId===p.ref),proof=stage.sides.move.find(m=>m.ref===p.ref)?.footprint;
   return part?.layer===2&&part.pins.length&&(proof?.kind==='through'?equal(flipPadEvidence(part.pins),proof):part.pins.every(pin=>pin.layer===2));
  }),'SHEET_SIDE_READBACK_REQUIRED');
  stage.sides.state='verified';await persist(ctx.dir,r);
 }
 const input=structuredClone(baseline.plan.input),units=mm=>input.unit==='mm'?mm:toMil(mm,'mm');
 const poses=stage.input.placements.map(v=>({uniqueId:v.ref,x:units(v.xMm),y:units(v.yMm),layer:v.layer??1,rotation:v.rotation,fixed:false,group:stage.input.name}));
 input.components.push(...poses);
 const plan=planLayout(input,doc);
 if(plan.status!=='ok')return {status:'failed',code:'SHEET_LAYOUT_PLAN_REJECTED',issues:plan.issues,mutationRequested:sideMutationRequested,
  finalPlacementRequested:false,orientedParts:doc.components.filter(c=>bottom.some(p=>p.ref===c.uniqueId)).map(({uniqueId,x,y,rotation,layer,primitiveBounds,pins})=>({uniqueId,x,y,rotation,layer,primitiveBounds,pins}))};
 if(!stage.position){
  const move=plan.poses.filter(p=>poses.some(x=>x.uniqueId===p.uniqueId)).map(p=>({id:p.id,ref:p.uniqueId,x:p.x,y:p.y,rotation:p.rotation,layer:p.layer}));
  stage.position={state:'pending',move};await persist(ctx.dir,r);
  stage.position.result=await nativeCall(a,t,stage,'place_pcb',{newUuid:stage.uuid,ids:doc.components.map(c=>c.id),poses:move});await persist(ctx.dir,r);
 }
 const after=await readBoard(a,t);
 const borders=native.objects.filter(o=>o.kind==='Pour').map(o=>({layer:o.layer,primitiveId:o.primitiveId}));
 if(borders.length&&!stage.refill){
  stage.refill={state:'pending',borders};await persist(ctx.dir,r);
  stage.refill.result=await a.invokeLossless(t.sessionId,routingScript({...t,operation:'refresh_planes',borders,layers:[...new Set(borders.map(b=>b.layer))]}),60000);
  await persist(ctx.dir,r);
 }
 if(stage.refill)requireState(stage.refill.result?.status==='ok','SHEET_REFILL_REQUIRES_READBACK');
 const observed=await readOwnedRouting(a,t),preserved=existingPcb(r,after,observed),layout=verifyLayoutSnapshot(plan,after,observed,baseline.outline);
 if(layout.status!=='matched')return {status:'unknown',code:'SHEET_NEW_PLACEMENTS_UNCONFIRMED',layout,nativeMutationReplayed:false};
 const combined={...t,schematicPageUuids:recordedPageIds(r),circuit:stage.combined},identity=await a.jlc_eda_verify_pcb(combined);
 requireState(identity.comparison?.status==='matched','SHEET_FINAL_ASSIGNMENTS_CHANGED');
 await verifyPriorPages(a,t,stage);const fresh=await readPage(a,t,stage.uuid);
 requireState(equal(fresh.design,stage.verifiedSchematic),'SHEET_FINAL_SCHEMATIC_CHANGED');
 const archives=await capturePlacementArchives(a,{...t,schematicPageUuids:recordedPageIds(r)}),newParts=after.components.filter(c=>poses.some(p=>p.uniqueId===c.uniqueId)),ids=newParts.map(c=>c.id);
 const models=fresh.doc.components.flatMap(c=>[c.device?.uuid,c.symbol?.uuid,c.footprint?.uuid]).filter(Boolean);
 const originalNames=new Set(r.continuation.selectedStage.document.components.flatMap(c=>c.pins.map(p=>p.net)));
 const nets=stage.combined.nets.filter(n=>!originalNames.has(n.name)).map(n=>JSON.stringify(['NET',n.name]));
 const fills=fillRecordEdits(stage,t,r.continuation.selectedStage.native,observed,archives.pcbData);
 const full=preserveArchive(stage.before.pcbData,archives.pcbData,{mainUuid:t.pcbDocumentUuid,newIds:[...ids,...nets],newParents:ids,allowNewModels:models,edits:[...(stage.sourcePadEdits??[]),...fills]});
 if(full.status!=='matched')return {status:'unknown',code:'SHEET_SAVED_BOARD_DELTA_UNCONFIRMED',full};
 const drc=await a.invokeLossless(t.sessionId,routingScript({...t,operation:'check'}),60000);
 requireState(drc.status==='ok'&&drc.strict&&equal(drc.beforeRules,drc.afterRules),'SHEET_FRESH_DRC_REQUIRED');
 const source=JSON.parse(await readFile(r.continuation.sourceJournalCopy)),actualCopper=auditCopper(after,observed,{viaMembership:true});
 const delta=sheetDrcDelta(source.finish.disk.drc.errors,drc.errors,newParts,source.finish.disk.document.components,stage.input.sourcePins,{source:source.finish.disk,actual:actualCopper,native:observed});
 if(delta.status!=='matched')return {status:'unknown',code:'SHEET_DRC_OUTSIDE_NEW_OPEN_PADS',drc,delta};
 if(stage.refill)requireState(!actualCopper.issues.length&&!source.finish.disk.copper.nets.some(n=>n.connectedGroups.some(group=>
  !actualCopper.nets.find(q=>q.net===n.net)?.connectedGroups.some(g=>group.every(p=>g.some(v=>v.id===p.id))))),'SHEET_ORIGINAL_COPPER_GROUP_SPLIT');
 if(stage.refill)stage.refill.state='completed';
 stage.position.state='completed';stage.accepted={oldSchematic:stage.before.schematic,newSchematic:fresh.design,pcb:archives.pcb,full,preserved,drcDelta:delta};
 r.circuit=stage.combined;r.pcbSyncBaseline={inputFingerprint:fingerprint(stage.combined),after:pcbSnapshot(after)};
 r.pcbLayoutBaseline={after:pcbSnapshot(after),plan,outline:baseline.outline};r.pcbCopperBaseline={after:pcbSnapshot(after),native:observed,archives};
 r.documents=(await a.jlc_eda_inspect_project(t)).documents;await persist(ctx.dir,r);
 return {status:'ok',pageUuid:stage.uuid,layout,accepted:stage.accepted};
}
export async function addPageWorkflow(a,p){
 const allowed=['renderMode','sourcePath','sourceCheckpointPath','outputDirectory','requestId','mode','pageAddition','pageWires','phase'];
 requireState(Object.keys(p).every(k=>allowed.includes(k))&&(!p.pageWires||p.phase==='schematic'),'SHEET_MODE_INPUT_CONFLICT');
 requireState(p.pageAddition&&[p.sourcePath,p.sourceCheckpointPath,p.outputDirectory].every(path.isAbsolute),'SHEET_ADDITION_BINDING_REQUIRED');
 const source=await realpath(p.sourcePath),sourceDir=path.dirname(source),file=await realpath(p.sourceCheckpointPath);
 requireState(file===path.join(sourceDir,'work-project.json'),'SHEET_SOURCE_JOURNAL_REQUIRED');
 if(p.phase==='derive'){
  const exists=await stat(path.join(p.outputDirectory,'work-project.json')).then(()=>true).catch(e=>{if(e.code==='ENOENT')return false;throw e;});
  const prior=exists?await load(p.outputDirectory):null;
  if(!prior?.addedSheet){
   const parent=await load(sourceDir);requireState(parent.path===source,'SHEET_SOURCE_PATH_MISMATCH');
   return a.jlc_eda_resume_work_project({sourceWorkDirectory:sourceDir,outputDirectory:p.outputDirectory,requestId:p.requestId,circuit:parent.circuit,renderMode:p.renderMode});
  }
 }
 const dir=await realpath(p.outputDirectory),r=await load(dir),origin=r.continuation;
 requireState(r.kind==='task_work_project'&&origin?.sourcePath===source&&['closed_routed_layout','closed_unrouted_layout'].includes(origin.selectedStage?.kind)&&origin.requestId===p.requestId&&
  digest(await readFile(file))===origin.sourceCheckpointSha256&&digest(await readFile(source))===origin.sourceSha256,'SHEET_SOURCE_BINDING_CHANGED');
 const hash=fingerprint(p.pageAddition);
 if(r.finish?.state==='closed'){requireState(r.addedSheet?.hash===hash,'SHEET_REQUEST_CONFLICT');return closedWorkResult(dir,r);}
 const t={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid,schematicUuid:r.schematicUuid,schematicPageUuid:r.schematicPageUuid,pcbDocumentUuid:r.pcbDocumentUuid,workDirectory:dir,requestId:p.requestId};
 await bound(a,t,{focusSchematic:false});const ctx={dir,r};
 if(r.addedSheet&&r.addedSheet.hash!==hash&&p.phase==='complete'){
  const s=r.addedSheet;requireState(s.sync?.state==='verified'&&!s.position&&equal({...s.input,placements:p.pageAddition.placements},p.pageAddition),'SHEET_REQUEST_CONFLICT');
  appendSheetCircuit(r.circuit,p.pageAddition);
  s.initialPlacements??=s.input.placements;s.input=p.pageAddition;s.hash=hash;await persist(dir,r);
 }
 if(r.addedSheet&&r.addedSheet.hash!==hash){
  const s=r.addedSheet;requireState(p.phase==='place_page'&&s.placed&&!s.wiresHash&&(!s.reposition||s.reposition===hash),'SHEET_REQUEST_CONFLICT');
  const revised=structuredClone(s.input);requireState(revised.circuit.components.length===p.pageAddition.circuit.components.length,'SHEET_REQUEST_CONFLICT');
  for(const [i,part]of revised.circuit.components.entries())part.pose=p.pageAddition.circuit.components[i].pose;
  requireState(equal(revised,p.pageAddition),'SHEET_REQUEST_CONFLICT');
  const page=await readPage(a,t,s.uuid);requireState(!page.doc.counts.wires,'SHEET_WIRED_POSES_IMMUTABLE');
  s.reposition=hash;await persist(dir,r);
  for(const [i,part]of revised.circuit.components.entries())if(!equal(s.input.circuit.components[i].pose,part.pose)){
   const prefix=actionPrefix(s),primitiveId=r.actions[prefix+'place/'+part.ref]?.result?.primitiveId??
    r.actions[prefix+'placements/'+(i-i%8)]?.result?.written?.find(w=>w.ref===part.ref)?.primitiveId;
   requireState(primitiveId,'SHEET_PLACED_ID_UNCONFIRMED');
   const v=await action(a,{...t,schematicPageUuid:s.uuid},ctx,actionPrefix(s)+'pose/'+part.ref,{operation:'new_page_pose',primitiveId,ref:part.ref,designator:part.designator,pose:part.pose});
   requireState(v.status==='ok','SHEET_POSE_UNCONFIRMED');
  }
  s.input=revised;s.hash=hash;s.combined=appendSheetCircuit(r.circuit,revised);await persist(dir,r);
 }
 if(!r.addedSheet){
  requireState(p.phase==='plan'&&!unresolvedActions(r).length,'SHEET_PLAN_REQUIRED');
  const combined=appendSheetCircuit(r.circuit,p.pageAddition),snapshot=await capturePlacementArchives(a,t);
  requireState(equal(snapshot.schematic,origin.selectedStage.design.schematic)&&equal(snapshot.pcb,origin.selectedStage.design.pcb),'SHEET_PARENT_ARCHIVES_CHANGED');
  const design=origin.selectedStage.design,priorPages=(await pageTree(a,t)).map(({uuid,name})=>({uuid,name}));
  const pages=design.schematicPages??{[r.schematicPageUuid]:design.schematic};
  requireState(priorPages.length>0&&priorPages.length<MAX_SCHEMATIC_PAGES&&priorPages.length===Object.keys(pages).length&&priorPages.every(x=>pages[x.uuid]&&x.name!==p.pageAddition.name),'SHEET_SOURCE_PAGE_SET_INVALID');
  r.addedSheet={hash,input:p.pageAddition,combined,priorPages,before:{...snapshot,schematicPages:pages}};
  if(p.pageAddition.sourcePins){
   const pins=p.pageAddition.sourcePins,plans={};
   for(const uuid of new Set(pins.map(s=>s.pageUuid))){
    requireState(priorPages.some(p=>p.uuid===uuid),'SHEET_SOURCE_PIN_PAGE');
    const page=await readPage(a,t,uuid);requireState(equal(page.design,pages[uuid]),'SHEET_SOURCE_PIN_PAGE_CHANGED');
    plans[uuid]={archive:page.data,stubs:sourcePinStubs(pins.filter(s=>s.pageUuid===uuid),page.doc,oldSchematicLines(page.data,uuid))};
   }
   r.addedSheet.sourcePinPlans=plans;
   r.addedSheet.sourcePadEdits=deferredPadEdits(nativeModelRecords(snapshot.pcbData).get(t.pcbDocumentUuid),pins,origin.selectedStage.document.components);
  }
  if(p.pageAddition.sourceLabels){
   r.addedSheet.labelPlans={};
   for(const uuid of new Set(p.pageAddition.sourceLabels.map(l=>l.pageUuid))){
    requireState(priorPages.some(p=>p.uuid===uuid),'SHEET_SOURCE_LABEL_PAGE');
    const page=await readPage(a,t,uuid);requireState(equal(page.design,pages[uuid]),'SHEET_SOURCE_LABEL_PAGE_CHANGED');
    sourceLabelEdits(nativeModelRecords(page.data).get(uuid).rows,p.pageAddition.sourceLabels.filter(l=>l.pageUuid===uuid));
    r.addedSheet.labelPlans[uuid]={};
   }
  }
  await verifyPriorPages(a,t,r.addedSheet);await persist(dir,r);
 }
 const stage=r.addedSheet;
 if(p.phase==='derive')return {status:'ok',reused:true,workDirectory:dir,path:r.path,sessionId:r.sessionId,projectUuid:r.projectUuid,pageUuid:stage.uuid??null};
 if(p.phase==='plan')return {status:'ok',plannedParts:p.pageAddition.circuit.components.map(c=>c.ref),netNames:stage.combined.nets.map(n=>n.name),sourceSha256:origin.sourceSha256};
 if(p.phase==='place_page')return createAndPlace(a,ctx,t,stage);
 if(p.phase==='schematic')return drawPage(a,ctx,t,stage,p.pageWires);
 if(p.phase==='sync'||p.phase==='verify_sync')return syncPage(a,ctx,t,stage,p.phase==='verify_sync');
 if(p.phase==='complete')return completePage(a,ctx,t,stage);
 if(p.phase==='preview'){
  requireState(stage.verifiedSchematic,'SHEET_VERIFIED_LOGIC_REQUIRED');
  const selected=await readPage(a,t,stage.uuid);requireState(equal(selected.design,stage.verifiedSchematic),'SHEET_PREVIEW_SOURCE_CHANGED');
  const png=await readSchematicPng(a,{...t,schematicPageUuid:stage.uuid});
  const pages=await pageTree(a,t);requireState(pages.find(d=>d.uuid===stage.uuid)?.name===stage.input.name,'SHEET_PREVIEW_TARGET_CHANGED');
  const image=pagePreviewPng(png,stage.input.name,pages),output=path.join(dir,'added-page.png');
  await writeFile(output,image.bytes);return {status:'ok',path:output,pageUuid:stage.uuid,member:image.name,schematic:selected.design};
 }
 if(p.phase==='verify'||p.phase==='finish'){
  requireState(stage.accepted,'SHEET_STAGE_VERIFICATION_REQUIRED');
  const target={...t,schematicPageUuids:recordedPageIds(r),circuit:r.circuit};
  const checked=await a.jlc_eda_check_pcb(target);
  if(checked.status!=='ok'||checked.identity?.comparison?.status!=='matched'||checked.layout?.status!=='matched'||checked.fullArchive?.status!=='matched'||!checked.rulesMatched)return {...checked,status:'unknown',code:'SHEET_FINAL_CHECK_FAILED'};
  const fresh=await readPage(a,t,stage.uuid);requireState(equal(fresh.design,stage.accepted.newSchematic),'SHEET_NEW_PAGE_ARCHIVE_CHANGED');
  const parent=JSON.parse(await readFile(r.continuation.sourceJournalCopy));
  const delta=sheetDrcDelta(parent.finish.disk.drc.errors,checked.drc.errors,checked.document.components.filter(c=>stage.input.placements.some(p=>p.ref===c.uniqueId)),parent.finish.disk.document.components,stage.input.sourcePins,{source:parent.finish.disk,actual:auditCopper(checked.document,checked.native,{viaMembership:true}),native:checked.native});
  requireState(delta.status==='matched','SHEET_FINAL_DRC_CHANGED');
  return p.phase==='verify'?{...checked,pageUuid:stage.uuid,drcDelta:delta}:a.jlc_eda_finish_work_project(target);
 }
 return {status:'unsupported',code:'SHEET_PHASE_UNSUPPORTED'};
}
