import {z} from 'zod';
import path from 'node:path';
import {readFile,realpath,stat,writeFile} from 'node:fs/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import {unzipSync} from 'fflate';
import {circuitSchema,drawingScript,fingerprint,enrichModelSources} from './drawing.mjs';
import {bound,load,persist,action,closedWorkResult} from './workflow.mjs';
import {digest} from './facts.mjs';
import {pcbSnapshot,comparePreservedPcbSnapshot} from './pcb.mjs';
import {capturePlacementArchives} from './placement-evidence.mjs';
import {archiveDesignFingerprint} from './resources.mjs';
import {readOwnedRouting,compareRoutingCheckpoint,routingScript} from './p3.mjs';
import {preserveArchive} from './eco-preservation.mjs';
import {unresolvedActions,verifyLayoutSnapshot} from './pcb-validation.mjs';
import {planLayout,toMil} from './layout.mjs';
import {compareNativeDrc} from './drc-comparison.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),coord=z.number().finite(),point=z.tuple([coord,coord]);
export const pageAdditionSchema=z.object({name:z.string().trim().min(1).max(80),circuit:circuitSchema,placements:z.array(z.object({ref:id,xMm:coord,yMm:coord,rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)])}).strict()).min(1).max(200)}).strict();
export const pageWiresSchema=z.array(z.object({net:z.string().min(1),lines:z.array(z.tuple([coord,coord,coord,coord])).min(1).max(180),labelAt:point.optional()}).strict()).min(1).max(100);
const requireState=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'unknown'});};
export function pagePreviewPng(data,pageName,pages){
 const png=Buffer.from([137,80,78,71,13,10,26,10]);
 const entries=Object.entries(unzipSync(data)).filter(([name])=>name.toLowerCase().endsWith('.png'));
 const members=entries.map(([name,bytes])=>({name,stem:name.replace(/_\d{4}-\d{2}-\d{2}\.png$/i,''),bytes:Buffer.from(bytes)}));
 requireState(new Set(pages.map(p=>p.name)).size===pages.length&&members.length===pages.length,'SHEET_PREVIEW_MEMBERSHIP');
 const matches=pages.map(p=>members.filter(m=>m.stem.endsWith('-'+p.name)&&/_\d+$/.test(m.stem.slice(0,-p.name.length-1))));
 requireState(matches.every(m=>m.length===1&&m[0].bytes.subarray(0,8).equals(png))&&new Set(matches.map(m=>m[0].name)).size===pages.length,'SHEET_PREVIEW_MEMBER_AMBIGUOUS');
 const index=pages.findIndex(p=>p.name===pageName);requireState(index>=0,'SHEET_PREVIEW_PAGE_MISSING');return matches[index][0];
}
export function appendSheetCircuit(before,input){
 const added=input.circuit,refs=new Set(added.components.map(c=>c.ref));
 requireState(!before.components.some(o=>refs.has(o.ref)||added.components.some(n=>n.designator===o.designator)),'SHEET_COMPONENT_ALREADY_EXISTS');
 requireState(input.placements.length===refs.size&&new Set(input.placements.map(p=>p.ref)).size===refs.size&&input.placements.every(p=>refs.has(p.ref)),'SHEET_PCB_PLACEMENTS_INCOMPLETE');
 const nets=structuredClone(before.nets);
 for(const n of added.nets){const old=nets.find(v=>v.name===n.name);if(old)old.endpoints.push(...n.endpoints);else nets.push(structuredClone(n));}
 const openPins=[...(before.openPins??[]),...(added.openPins??[])];
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
 const pages=await info();if(!pages?.some(x=>x.uuid===p.schematicPageUuid))return {status:'failed',code:'SHEET_NATIVE_TARGET_CHANGED'};
 if(p.operation==='create'){
  if(pages.length!==1)return {status:'failed',code:'SHEET_CREATION_PRECONDITION'};
  const uuid=await eda.dmt_Schematic.createSchematicPage(p.schematicUuid);
  return {status:typeof uuid==='string'?'ok':'unknown',uuid};
 }
 if(pages.length!==2||!pages.some(x=>x.uuid===p.newUuid))return {status:'failed',code:'SHEET_PAIR_CHANGED'};
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
   const moved=await eda.pcb_PrimitiveComponent.modify(v.id,{x:v.x,y:v.y,rotation:v.rotation,layer:1,primitiveLock:false});if(!moved)return {status:'unknown',code:'SHEET_NEW_PART_MOVE_UNCONFIRMED',poses};poses.push(v.id);
  }return {status:'ok',poses};
 }
 return {status:'unsupported',code:'SHEET_UNKNOWN_OPERATION'};
}
const nativeCall=(a,t,operation,extra={})=>a.invokeLossless(t.sessionId,'('+nativeSheet.toString()+')('+JSON.stringify({...t,operation,...extra})+')',60000);
async function pageTree(a,t){
 const project=await a.jlc_eda_inspect_project({sessionId:t.sessionId,expectedProjectUuid:t.expectedProjectUuid,waitForReady:true}),board=project.boards?.filter(b=>b.schematicUuid===t.schematicUuid&&b.pcbDocumentUuid===t.pcbDocumentUuid);
 requireState(project.status==='ok'&&project.project.uuid===t.expectedProjectUuid&&board?.length===1,'SHEET_BOARD_ASSOCIATION');
 return project.documents.filter(d=>d.itemType==='Schematic Page'&&d.parentSchematicUuid===t.schematicUuid&&board[0].schematicPageUuids.includes(d.uuid));
}
async function createAndPlace(a,ctx,t,stage){
 const {r,dir}=ctx;let pages=await pageTree(a,t);
 if(!stage.creation){
  requireState(pages.length===1&&pages[0].uuid===t.schematicPageUuid&&pages[0].name!==stage.input.name,'SHEET_SOURCE_MUST_HAVE_ONE_PAGE');
  stage.creation={state:'pending'};await persist(dir,r);
  stage.creation.result=await nativeCall(a,t,'create');await persist(dir,r);
 }
 pages=await pageTree(a,t);const fresh=pages.filter(x=>x.uuid!==t.schematicPageUuid);
 requireState(pages.length===2&&fresh.length===1&&stage.creation.result?.status==='ok'&&fresh[0].uuid===stage.creation.result.uuid&&(!stage.uuid||fresh[0].uuid===stage.uuid),'SHEET_CREATION_OUTCOME_UNCONFIRMED');
 stage.uuid=fresh[0].uuid;stage.creation.state='completed';await persist(dir,r);
 if(fresh[0].name!==stage.input.name){
  requireState(!stage.rename,'SHEET_RENAME_OUTCOME_UNCONFIRMED');stage.rename={state:'pending'};await persist(dir,r);
  stage.rename.result=await nativeCall(a,t,'rename',{newUuid:stage.uuid,name:stage.input.name});await persist(dir,r);
 }
 pages=await pageTree(a,t);requireState(pages.some(x=>x.uuid===stage.uuid&&x.name===stage.input.name),'SHEET_NAME_UNCONFIRMED');
 if(stage.rename)stage.rename.state='completed';await persist(dir,r);
 const target={...t,schematicPageUuid:stage.uuid};const before=await readPage(a,t,stage.uuid);
 if(!stage.blank){requireState(!before.doc.components.length&&!before.doc.counts.wires,'SHEET_NEW_PAGE_NOT_EMPTY');stage.blank=before.data;await persist(dir,r);}
 for(const part of stage.input.circuit.components){
  if(r.actions['added-page/pose/'+part.ref]?.state==='completed')continue;
  const v=await action(a,target,ctx,'added-page/place/'+part.ref,{operation:'place',component:part});requireState(v.status==='ok',v.code??'SHEET_PART_UNCONFIRMED');
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
 for(const [i,g]of groups.entries()){
  const key='added-page/wire/'+i;
  const v=await action(a,target,ctx,key,{operation:'junction',net:g.net,anchors:g.anchors,lines:g.lines});requireState(v.status==='ok',v.code??'SHEET_WIRE_UNVERIFIED');
  if(g.labelAt){const l=await action(a,target,ctx,key+'/label',{operation:'junction_label',net:g.net,wireId:v.wireId,labelAt:g.labelAt});requireState(l.status==='ok',l.code??'SHEET_LABEL_UNVERIFIED');}
 }
 for(const pin of stage.input.circuit.nc){
  const part=stage.input.circuit.components.find(c=>c.ref===pin.ref);
  const v=await action(a,target,ctx,'added-page/nc/'+pin.ref+'/'+pin.pin,{operation:'connect',endpoint:{...pin,designator:part.designator},nc:true});requireState(v.status==='ok',v.code??'SHEET_NC_UNVERIFIED');
 }
 for(const [i,note]of stage.input.circuit.notes.entries()){
  const v=await action(a,target,ctx,'added-page/note/'+i,{operation:'note',note});requireState(v.status==='ok','SHEET_NOTE_UNVERIFIED');
 }
 const result=await a.jlc_eda_verify_schematic({...t,pcbDocumentUuid:undefined,schematicPageUuids:[t.schematicPageUuid,stage.uuid],circuit:stage.combined});
 if(result.status!=='ok'||result.comparison?.status!=='matched')return {...result,status:'unknown',code:'SHEET_COMBINED_NETLIST_UNVERIFIED'};
 const old=await readPage(a,t,t.schematicPageUuid),fresh=await readPage(a,t,stage.uuid);
 requireState(equal(old.design,stage.before.schematic),'SHEET_ORIGINAL_SCHEMATIC_CHANGED');
 requireState(fresh.doc.components.length===stage.input.circuit.components.length&&fresh.doc.components.every(c=>stage.input.circuit.components.some(n=>n.ref===c.uniqueId)),'SHEET_MEMBER_CHANGED');
 stage.verifiedSchematic=fresh.design;await persist(ctx.dir,ctx.r);
 return {status:'ok',pageUuid:stage.uuid,schematic:fresh.design,originalSchematic:old.design,netlist:result.netlist,comparison:result.comparison};
}
async function readBoard(a,t){
 const doc=await a.jlc_eda_read_document({...t,kind:'pcb',documentUuid:t.pcbDocumentUuid,includePins:true,includeGeometry:true,limit:200});
 requireState(doc.status==='ok'&&doc.truncated===false&&doc.counts.components===doc.components.length,'SHEET_PCB_DOCUMENT_UNVERIFIED');
 return doc;
}
function existingPcb(r,doc,native){
 const stage=r.continuation.selectedStage,old=stage.document,oldRefs=new Set(old.components.map(c=>c.uniqueId)),now=pcbSnapshot(doc);
 const original={...now,counts:{...now.counts,components:old.components.length},components:now.components.filter(c=>oldRefs.has(c.uniqueId))};
 const parts=comparePreservedPcbSnapshot(old,original,{expectedProjectUuid:stage.sourceProjectUuid,actualProjectUuid:doc.projectUuid});
 const copper=compareRoutingCheckpoint(stage.native,native);
 requireState(parts.status==='matched'&&copper.status==='matched','SHEET_PRIOR_PCB_OR_COPPER_CHANGED');
 return {parts,copper};
}
async function syncPage(a,ctx,t,stage,verifyOnly){
 requireState(stage.verifiedSchematic,'SHEET_VERIFIED_LOGIC_REQUIRED');
 const set=[t.schematicPageUuid,stage.uuid],combined={...t,schematicPageUuids:set,circuit:stage.combined};
 if(!stage.sync){
  requireState(!verifyOnly,'SHEET_NO_PENDING_SYNC');
  const logic=await a.jlc_eda_verify_schematic({...combined,pcbDocumentUuid:undefined});requireState(logic.comparison?.status==='matched','SHEET_SYNC_LOGIC_CHANGED');
  const old=await readPage(a,t,t.schematicPageUuid),fresh=await readPage(a,t,stage.uuid);
  requireState(equal(old.design,stage.before.schematic)&&equal(fresh.design,stage.verifiedSchematic),'SHEET_PREIMPORT_SCHEMATIC_CHANGED');
  const doc=await readBoard(a,t),native=await readOwnedRouting(a,t);existingPcb(ctx.r,doc,native);
  const before=await capturePlacementArchives(a,t);requireState(equal(before.pcb,stage.before.pcb)&&doc.components.length===ctx.r.continuation.selectedStage.document.components.length,'SHEET_PREIMPORT_PCB_CHANGED');
  const ids=doc.components.map(c=>c.id),lines=native.objects.filter(x=>x.kind==='Line').map(x=>[x.primitiveId,x.net,x.layer,x.startX,x.startY,x.endX,x.endY,x.lineWidth]);
  stage.sync={state:'pending'};await persist(ctx.dir,ctx.r);
  stage.sync.result=await nativeCall(a,t,'sync',{newUuid:stage.uuid,ids,lines});await persist(ctx.dir,ctx.r);
 }
 const v=await a.jlc_eda_verify_pcb(combined);
 if(v.status!=='ok'||v.comparison?.status!=='matched')return {...v,status:'unknown',code:'SHEET_PCB_IMPORT_READBACK_REQUIRED',nativeMutationReplayed:false};
 const native=await readOwnedRouting(a,t),preserved=existingPcb(ctx.r,v.pcbDocument,native);
 const archived=await capturePlacementArchives(a,t),newParts=v.schematicVerification.documents.find(doc=>doc.documentUuid===stage.uuid).components;
 const ids=newParts.map(c=>v.pcbDocument.components.find(n=>n.uniqueId===c.uniqueId).id),models=newParts.flatMap(c=>[c.device?.uuid,c.symbol?.uuid,c.footprint?.uuid]).filter(Boolean);
 const oldNames=new Set(ctx.r.continuation.selectedStage.document.components.flatMap(c=>c.pins.map(p=>p.net)));
 const newNets=stage.combined.nets.filter(n=>!oldNames.has(n.name)).map(n=>JSON.stringify(['NET',n.name]));
 const report=preserveArchive(stage.before.pcbData,archived.pcbData,{mainUuid:t.pcbDocumentUuid,newIds:[...ids,...newNets],newParents:ids,allowNewModels:models});
 if(report.status!=='matched')return {status:'unknown',code:'SHEET_PCB_ARCHIVE_DELTA_UNVERIFIED',report,ids,models};
 stage.sync.state='verified';stage.sync.proof=report;await persist(ctx.dir,ctx.r);
 return {status:'ok',pageUuid:stage.uuid,board:v.pcbDocument,comparison:v.comparison,preserved,archive:report};
}
export function sheetDrcDelta(before,after,addedParts){
 const pads=new Map(addedParts.flatMap(c=>c.pins.map(p=>[p.id,p]))),remaining=structuredClone(after),added=[];
 for(const group of remaining){
  if(group.name!=='Connection Error'||!Array.isArray(group.list))continue;
  for(const net of group.list){
   if(!Array.isArray(net.list))continue;
   const old=net.list.length;
   net.list=net.list.filter(e=>{
    const obj=e.explanation?.errData,p=pads.get(obj?.obj1);
    if(!p||e.errorType!=='Connection Error'||obj.errorType!=='No Connection'||!p.net||net.name!==p.net||e.net!==p.net||obj.net!==p.net)return true;
    added.push({padId:p.id,net:p.net});return false;
   });
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
 return {status:comparison.status,comparison,addedDisconnectedPads:added};
}
async function completePage(a,ctx,t,stage){
 const r=ctx.r;requireState(stage.sync?.state==='verified','SHEET_VERIFIED_SYNC_REQUIRED');
 if(stage.accepted)return {status:'ok',reused:true,accepted:stage.accepted};
 const baseline=r.pcbLayoutBaseline,doc=await readBoard(a,t),native=await readOwnedRouting(a,t);existingPcb(r,doc,native);
 const input=structuredClone(baseline.plan.input),units=mm=>input.unit==='mm'?mm:toMil(mm,'mm');
 const poses=stage.input.placements.map(v=>({uniqueId:v.ref,x:units(v.xMm),y:units(v.yMm),layer:1,rotation:v.rotation,fixed:false,group:stage.input.name}));
 input.components.push(...poses);
 const plan=planLayout(input,doc);if(plan.status!=='ok')return {status:'failed',code:'SHEET_LAYOUT_PLAN_REJECTED',issues:plan.issues,mutationRequested:false};
 if(!stage.position){
  const move=plan.poses.filter(p=>poses.some(x=>x.uniqueId===p.uniqueId)).map(p=>({id:p.id,ref:p.uniqueId,x:p.x,y:p.y,rotation:p.rotation}));
  stage.position={state:'pending',move};await persist(ctx.dir,r);
  stage.position.result=await nativeCall(a,t,'place_pcb',{newUuid:stage.uuid,ids:doc.components.map(c=>c.id),poses:move});await persist(ctx.dir,r);
 }
 const after=await readBoard(a,t),observed=await readOwnedRouting(a,t),preserved=existingPcb(r,after,observed),layout=verifyLayoutSnapshot(plan,after,observed,baseline.outline);
 if(layout.status!=='matched')return {status:'unknown',code:'SHEET_NEW_PLACEMENTS_UNCONFIRMED',layout,nativeMutationReplayed:false};
 const combined={...t,schematicPageUuids:[t.schematicPageUuid,stage.uuid],circuit:stage.combined},identity=await a.jlc_eda_verify_pcb(combined);
 requireState(identity.comparison?.status==='matched','SHEET_FINAL_ASSIGNMENTS_CHANGED');
 const prior=await readPage(a,t,t.schematicPageUuid),fresh=await readPage(a,t,stage.uuid);
 requireState(equal(prior.design,stage.before.schematic)&&equal(fresh.design,stage.verifiedSchematic),'SHEET_FINAL_SCHEMATIC_CHANGED');
 const archives=await capturePlacementArchives(a,t),newParts=after.components.filter(c=>poses.some(p=>p.uniqueId===c.uniqueId)),ids=newParts.map(c=>c.id);
 const models=fresh.doc.components.flatMap(c=>[c.device?.uuid,c.symbol?.uuid,c.footprint?.uuid]).filter(Boolean);
 const originalNames=new Set(r.continuation.selectedStage.document.components.flatMap(c=>c.pins.map(p=>p.net)));
 const nets=stage.combined.nets.filter(n=>!originalNames.has(n.name)).map(n=>JSON.stringify(['NET',n.name]));
 const full=preserveArchive(stage.before.pcbData,archives.pcbData,{mainUuid:t.pcbDocumentUuid,newIds:[...ids,...nets],newParents:ids,allowNewModels:models});
 if(full.status!=='matched')return {status:'unknown',code:'SHEET_SAVED_BOARD_DELTA_UNCONFIRMED',full};
 const drc=await a.invokeLossless(t.sessionId,routingScript({...t,operation:'check'}),60000);
 requireState(drc.status==='ok'&&drc.strict&&equal(drc.beforeRules,drc.afterRules),'SHEET_FRESH_DRC_REQUIRED');
 const source=JSON.parse(await readFile(r.continuation.sourceJournalCopy)),delta=sheetDrcDelta(source.finish.disk.drc.errors,drc.errors,newParts);
 if(delta.status!=='matched')return {status:'unknown',code:'SHEET_DRC_OUTSIDE_NEW_OPEN_PADS',drc,delta};
 stage.position.state='completed';stage.accepted={oldSchematic:prior.design,newSchematic:fresh.design,pcb:archives.pcb,full,preserved,drcDelta:delta};
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
   const primitiveId=r.actions['added-page/place/'+part.ref]?.result?.primitiveId;
   const v=await action(a,{...t,schematicPageUuid:s.uuid},ctx,'added-page/pose/'+part.ref,{operation:'new_page_pose',primitiveId,ref:part.ref,designator:part.designator,pose:part.pose});
   requireState(v.status==='ok','SHEET_POSE_UNCONFIRMED');
  }
  s.input=revised;s.hash=hash;s.combined=appendSheetCircuit(r.circuit,revised);await persist(dir,r);
 }
 if(!r.addedSheet){
  requireState(p.phase==='plan'&&!unresolvedActions(r).length,'SHEET_PLAN_REQUIRED');
  const combined=appendSheetCircuit(r.circuit,p.pageAddition),snapshot=await capturePlacementArchives(a,t);
  requireState(equal(snapshot.schematic,origin.selectedStage.design.schematic)&&equal(snapshot.pcb,origin.selectedStage.design.pcb),'SHEET_PARENT_ARCHIVES_CHANGED');
  r.addedSheet={hash,input:p.pageAddition,combined,before:snapshot};await persist(dir,r);
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
  const img=await a.invoke(t.sessionId,drawingScript({...t,schematicPageUuid:stage.uuid,operation:'preview',format:'png'}));
  if(img.status!=='ok')return img;
  const pages=await pageTree(a,t);requireState(pages.find(d=>d.uuid===stage.uuid)?.name===stage.input.name,'SHEET_PREVIEW_TARGET_CHANGED');
  const image=pagePreviewPng(Buffer.from(img.data,'base64'),stage.input.name,pages),output=path.join(dir,'added-page.png');
  await writeFile(output,image.bytes);return {status:'ok',path:output,pageUuid:stage.uuid,member:image.name,schematic:selected.design};
 }
 if(p.phase==='verify'||p.phase==='finish'){
  requireState(stage.accepted,'SHEET_STAGE_VERIFICATION_REQUIRED');
  const target={...t,schematicPageUuids:[t.schematicPageUuid,stage.uuid],circuit:r.circuit};
  const checked=await a.jlc_eda_check_pcb(target);
  if(checked.status!=='ok'||checked.identity?.comparison?.status!=='matched'||checked.layout?.status!=='matched'||checked.fullArchive?.status!=='matched'||!checked.rulesMatched)return {...checked,status:'unknown',code:'SHEET_FINAL_CHECK_FAILED'};
  const fresh=await readPage(a,t,stage.uuid);requireState(equal(fresh.design,stage.accepted.newSchematic),'SHEET_NEW_PAGE_ARCHIVE_CHANGED');
  const parent=JSON.parse(await readFile(r.continuation.sourceJournalCopy));
  const delta=sheetDrcDelta(parent.finish.disk.drc.errors,checked.drc.errors,checked.document.components.filter(c=>stage.input.placements.some(p=>p.ref===c.uniqueId)));
  requireState(delta.status==='matched','SHEET_FINAL_DRC_CHANGED');
  return p.phase==='verify'?{...checked,pageUuid:stage.uuid,drcDelta:delta}:a.jlc_eda_finish_work_project(target);
 }
 return {status:'unsupported',code:'SHEET_PHASE_UNSUPPORTED'};
}
