import path from 'node:path';
import {readFile,realpath} from 'node:fs/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import {action,bound,closedWorkResult,load,persist} from './workflow.mjs';
import {drawingScript,fingerprint} from './drawing.mjs';
import {digest} from './facts.mjs';
import {pcbBound,pcbScript,pcbSnapshot} from './pcb.mjs';
import {scripts} from './native-scripts.mjs';
import {planJunctions} from './schematic-junction.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {preserveArchive} from './eco-preservation.mjs';
import {archiveDesignFingerprint} from './resources.mjs';

function requireState(ok,code){if(!ok)throw Object.assign(Error(code),{code,status:'failed'});}
export function decouplingDelta(before,after){
  requireState(after && after.components.length===before.components.length+1,'DECOUPLING_ONE_CAPACITOR_REQUIRED');
  const cap=after.components.find(x=>!before.components.some(c=>c.ref===x.ref));
  requireState(cap && /^C\d+$/.test(cap.designator) && equal(after.components.filter(c=>c!==cap),before.components)
    && equal(after.nc,before.nc) && equal(after.notes,before.notes),'DECOUPLING_EXISTING_CIRCUIT_CHANGED');
  const deferred=before.openPins??[],remaining=after.openPins??[];
  const released=deferred.filter(p=>!remaining.some(q=>equal(p,q)));
  requireState(released.length===1 && equal(deferred.filter(p=>p!==released[0]),remaining),'DECOUPLING_ONE_OPEN_PIN_REQUIRED');
  const pin=released[0],supply=after.nets.find(n=>!before.nets.some(o=>o.name===n.name));
  requireState(supply?.junction && after.nets.length===before.nets.length+1 && supply.endpoints.length===2
    && supply.endpoints.some(p=>p.ref===cap.ref && p.pin==='1')
    && supply.endpoints.some(p=>p.ref===pin.ref && p.pin===pin.pin),'DECOUPLING_NEW_SUPPLY_REQUIRED');
  const ground=after.nets.find(n=>n.name==='GND'),returns=ground?.endpoints.filter(p=>p.ref===cap.ref);
  requireState(returns?.length===1 && returns[0].pin==='2' && !ground.junction,'DECOUPLING_GROUND_RETURN_REQUIRED');
  const priorNets=after.nets.filter(n=>n!==supply).map(n=>n===ground?{...n,endpoints:n.endpoints.filter(p=>p.ref!==cap.ref)}:n);
  requireState(equal(priorNets,before.nets),'DECOUPLING_EXISTING_NET_CHANGED');
  return {cap,pin,supply,ground:returns[0]};
}
async function capture(a,t,kind){
  const sch=kind==='schematic',documentUuid=sch?t.schematicPageUuid:t.pcbDocumentUuid;
  const f=await a.invoke(t.sessionId,scripts.focus({...t,kind,documentUuid}));requireState(f.status==='ok',f.code??'DECOUPLING_FOCUS_FAILED');
  const s=await a.invoke(t.sessionId,(sch?drawingScript:pcbScript)({...t,operation:'archive'}));
  requireState(s.status==='ok'&&s.data,'DECOUPLING_ARCHIVE_UNAVAILABLE');return s.data;
}
const projectModels=c=>[c.device?.uuid,c.symbol?.uuid,c.footprint?.uuid].filter(Boolean);
function schematicProof(before,after,t,part,actions){
  const placed=actions.place.result,rail=actions.rail.result,ground=actions.ground.result;
  const parents=[placed.primitiveId,rail.wireId,ground.wireId,ground.labelId];
  const rows=nativeModelRecords(after).get(t.schematicPageUuid).rows;
  const lineSets=new Map([[rail.wireId,actions.rail.input.lines],[ground.wireId,[[ground.pin.x,ground.pin.y,ground.end.x,ground.end.y]]]]);
  const ids=[...parents];
  for(const [group,lines] of lineSets){
    const actual=rows.filter(r=>r.type==='LINE'&&r.body.lineGroup===group);
    const stored=actual.map(({body:b})=>[b.startX,-b.startY,b.endX,-b.endY]);
    requireState(actual.length===lines.length && lines.every(l=>stored.some(s=>equal(s,l)||equal([s[2],s[3],s[0],s[1]],l))),'DECOUPLING_WIRE_GEOMETRY_CHANGED');
    ids.push(...actual.map(r=>r.id));
  }
  return preserveArchive(before,after,{mainUuid:t.schematicPageUuid,newIds:ids,newParents:parents,allowNewModels:projectModels(part)});
}
function pcbProof(before,after,t,d,doc,sch){
  const old=nativeModelRecords(before).get(t.pcbDocumentUuid),part=doc.components.find(c=>c.uniqueId===d.cap.ref);
  const parent=doc.components.find(x=>x.uniqueId===d.pin.ref);
  const pads=old.rows.filter(r=>r.type==='PAD_NET').filter(r=>{const id=JSON.parse(r.id);return id[1]===parent?.id && id[2]===d.pin.pin;});
  requireState(part && pads.length===1 && pads[0].body.padNet==='','DECOUPLING_PAD_BINDING_UNPROVEN');
  const capSymbol=sch.components.find(c=>c.uniqueId===d.cap.ref);
  const oldOwner=old.rows.find(r=>r.type==='COMPONENT'&&r.id===parent.id);
  const current=nativeModelRecords(after).get(t.pcbDocumentUuid);
  const newOwner=current.rows.find(r=>r.type==='COMPONENT'&&r.id===parent.id);
  const padRows=current.rows.filter(r=>r.type==='PAD_NET' && JSON.parse(r.id)[1]===part.id);
  requireState(padRows.length===2 && padRows.every(row=>{
    const [,owner,number,localId]=JSON.parse(row.id);
    return part.pins.some(pin=>pin.id===owner+localId && pin.number===number && pin.net===row.body.padNet);
  }),'DECOUPLING_NEW_PADS_UNCONFIRMED');
  requireState(oldOwner && newOwner && equal(oldOwner,newOwner),'DECOUPLING_OWNER_FIELDS_CHANGED');
  const edits=[{type:'PAD_NET',id:pads[0].id,after:{...pads[0].body,padNet:d.supply.name}}];
  // The native importer may reorder the keys of the owner's per-pad map.
  const reorderedOwnerKeys=fingerprint(oldOwner)!==fingerprint(newOwner);
  if(reorderedOwnerKeys)edits.push({type:'COMPONENT',id:parent.id,after:oldOwner.body});
  return {...preserveArchive(before,after,{mainUuid:t.pcbDocumentUuid,newIds:[part.id,JSON.stringify(['NET',d.supply.name])],
    newParents:[part.id],allowNewModels:projectModels(capSymbol),edits}),reorderedOwnerKeys};
}
async function applySchematic(a,t,ctx,stage,delta){
  const work=async(key,input)=>{const x=await action(a,t,ctx,'decoupling/'+key,input);requireState(x.status==='ok',x.code??'DECOUPLING_WRITE_UNCONFIRMED');return x;};
  await work('place',{operation:'place',component:delta.cap});
  const doc=await a.jlc_eda_read_document({...t,kind:'schematic',documentUuid:t.schematicPageUuid,includePins:true,limit:200});
  requireState(doc.status==='ok','DECOUPLING_PLACEMENT_UNCONFIRMED');
  const rail=planJunctions(t.circuit,doc).get(delta.supply.name);
  const wire=await work('rail',{operation:'junction',net:delta.supply.name,anchors:rail.anchors,lines:rail.lines});
  if(rail.labelAt)await work('label',{operation:'junction_label',net:delta.supply.name,wireId:wire.wireId,labelAt:rail.labelAt});
  await work('ground',{operation:'connect',net:'GND',endpoint:{...delta.ground,designator:delta.cap.designator}});
  const v=await a.jlc_eda_verify_schematic({...t,pcbDocumentUuid:undefined});
  if(v.status!=='ok'||v.comparison?.status!=='matched')return {...v,status:'unknown',code:'DECOUPLING_SCHEMATIC_NETLIST_MISMATCH'};
  const part=v.document.components.find(c=>c.uniqueId===delta.cap.ref);
  const after=await capture(a,t,'schematic'),acts=ctx.r.actions;
  const proof=schematicProof(stage.beforeSch,after,t,part,{place:acts['decoupling/place'],rail:acts['decoupling/rail'],ground:acts['decoupling/ground']});
  if(proof.status!=='matched')return {status:'unknown',code:'DECOUPLING_SCHEMATIC_PRESERVATION',proof};
  const saved=await a.invoke(t.sessionId,drawingScript({...t,operation:'save'}));
  requireState(saved.nativeSaveResult===true,'DECOUPLING_SCHEMATIC_SAVE_UNCONFIRMED');
  stage.schDesign=archiveDesignFingerprint(after);stage.schematicVerified=true;await persist(ctx.dir,ctx.r);
  return {status:'ok',comparison:v.comparison,proof,schematicSave:saved};
}
async function verifySync(a,t,ctx,stage,d){
  const v=await a.jlc_eda_verify_pcb(t);
  if(v.status!=='ok'||v.comparison?.status!=='matched')return {...v,status:'unknown',code:'DECOUPLING_PCB_ASSIGNMENTS_UNCONFIRMED'};
  const sch=await capture(a,t,'schematic'),pcb=await capture(a,t,'pcb');
  const proof=pcbProof(stage.beforePcb,pcb,t,d,v.pcbDocument,v.schematicVerification.document);
  const noGeometry=Object.values(v.inventory?.standaloneCounts??{missing:1}).every(x=>x===0);
  if(proof.status!=='matched'||!noGeometry||!equal(archiveDesignFingerprint(sch),stage.schDesign))
    return {status:'unknown',code:'DECOUPLING_PCB_PRESERVATION',proof,noGeometry};
  const snapshot=pcbSnapshot(v.pcbDocument);
  // The editor qualifies project-library UUIDs with the working copy's own project identity.
  const old=pcbSnapshot(ctx.r.derivation.synchronizedVerification.pcbDocument).components;
  for(const baseline of old){
    const observed=snapshot.components.find(c=>c.uniqueId===baseline.uniqueId);
    const planned=structuredClone(baseline);
    if(planned.uniqueId===d.pin.ref)planned.pins.find(p=>p.number===d.pin.pin).net=d.supply.name;
    requireState(equal(planned,observed),'DECOUPLING_EXISTING_INSTANCE_CHANGED');
  }
  ctx.r.circuit=t.circuit;ctx.r.pcbSyncBaseline={inputFingerprint:fingerprint(t.circuit),after:snapshot};
  const op=ctx.r.pcbSyncActions[t.requestId];op.state='completed';op.after=snapshot;stage.completed=true;ctx.r.actions['decoupling/stage'].state='completed';
  await persist(ctx.dir,ctx.r);
  return {status:'ok',comparison:v.comparison,proof,inventory:v.inventory,originalInstancesRetained:old.length,importReceipt:op.nativeImport};
}
export async function decouplingWorkflow(a,p){
  requireState(!p.addition&&!p.noteChanges&&!p.passiveChanges&&!p.candidateSupplierIds&&!p.candidateSupplierId&&!p.targetDesignator&&!p.noteId,'ECO_MODE_INPUT_CONFLICT');
  const source=await realpath(p.sourcePath),checkpoint=await realpath(p.sourceCheckpointPath);
  const history=JSON.parse(await readFile(checkpoint));
  requireState(history.path===source && (await closedWorkResult(path.dirname(source),history)).status==='ok','DECOUPLING_CLOSED_SOURCE_REQUIRED');
  requireState(!p.renderMode||p.renderMode==='headless','DECOUPLING_HEADLESS_ONLY');
  if(p.phase==='derive'){
    const known=await load(p.outputDirectory).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if(known?.decoupling){
      requireState(known.requestId===p.requestId && known.derivation?.sourcePath===source &&
        known.derivation?.sourceCheckpoint?.path===checkpoint && known.derivation.sourceCheckpoint.sha256===digest(await readFile(checkpoint)) &&
        (!p.unroutedCircuit||equal(p.unroutedCircuit,known.decoupling.circuit)),'DECOUPLING_REQUEST_CONFLICT');
      if(known.finish?.state==='closed')return closedWorkResult(await realpath(p.outputDirectory),known);
      return {status:'ok',reused:true,path:known.path,sessionId:known.sessionId,completed:!!known.decoupling.completed};
    }
    return a.jlc_eda_derive_work_project({...p,sourcePcbState:'synchronized_unrouted',renderMode:'headless',circuit:history.circuit});
  }
  const dir=await realpath(p.outputDirectory),r=await load(dir);
  requireState(r.requestId===p.requestId && r.renderMode==='headless' && r.derivation?.sourcePath===source &&
    r.derivation?.sourceCheckpoint?.path===checkpoint && r.derivation.sourceCheckpoint.sha256===digest(await readFile(checkpoint)),'DECOUPLING_WORK_BINDING_MISMATCH');
  const circuit=p.unroutedCircuit??r.decoupling?.circuit,d=decouplingDelta(history.circuit,circuit);
  const t={sessionId:r.sessionId,expectedProjectUuid:r.projectUuid,schematicUuid:r.schematicUuid,schematicPageUuid:r.schematicPageUuid,pcbDocumentUuid:r.pcbDocumentUuid,workDirectory:dir,requestId:p.requestId,circuit};
  if(r.decoupling && !equal(r.decoupling.circuit,circuit)){
    // Actual placed symbols can have a different pin orientation from another capacitor of the same size.
    const previous=structuredClone(r.decoupling.circuit),prior=previous.nets.find(n=>n.name===d.supply.name);
    const oldJunction=prior.junction;prior.junction=d.supply.junction;
    requireState(p.phase==='plan' && equal(previous,circuit) && r.actions['decoupling/place']?.state==='completed' &&
      Object.keys(r.actions).every(k=>['decoupling/stage','decoupling/place'].includes(k)) && !r.decoupling.schematicVerified,'DECOUPLING_REQUEST_CONFLICT');
    const doc=await a.jlc_eda_read_document({...t,kind:'schematic',documentUuid:t.schematicPageUuid,includePins:true,limit:200});
    requireState(doc.components?.find(c=>c.uniqueId===d.cap.ref)?.id===r.actions['decoupling/place'].result.primitiveId,'DECOUPLING_PLACEMENT_UNCONFIRMED');
    planJunctions(circuit,doc);
    r.decoupling.circuit=circuit;r.decoupling.priorJunctions??=[];r.decoupling.priorJunctions.push(oldJunction);
    await persist(dir,r);return {status:'ok',delta:d,oldJunction,placedComponentReused:true};
  }
  if(p.phase==='finish'){requireState(r.decoupling?.completed,'DECOUPLING_NOT_SYNCHRONIZED');return a.jlc_eda_finish_work_project(t);}
  if(r.finish?.state==='closed')return closedWorkResult(dir,r);
  if(p.phase==='plan'){
    if(r.decoupling)return {status:'ok',reused:true,delta:d};
    const prev=await a.jlc_eda_verify_pcb({...t,circuit:history.circuit});
    requireState(prev.status==='ok'&&prev.comparison.status==='matched'&&Object.values(prev.inventory.standaloneCounts).every(n=>n===0),'DECOUPLING_UNROUTED_BASELINE_REQUIRED');
    const pins=prev.schematicVerification.netlist.components.find(c=>c.uniqueId===d.pin.ref)?.pins??[];
    requireState(pins.some(pin=>pin.number===d.pin.pin&&pin.name==='VDD'&&pin.net===''),'DECOUPLING_DIGITAL_VDD_REQUIRED');
    const lib=await a.jlc_eda_read_device({...t,deviceUuid:d.cap.deviceUuid,libraryUuid:d.cap.libraryUuid});
    const cap=lib.device;
    requireState(lib.status==='ok'&&cap.supplierId===d.cap.supplierId&&cap.manufacturerPart===d.cap.manufacturerPart&&cap.footprint.uuid===d.cap.footprintUuid&&cap.parameters.Value===d.cap.properties.Value&&['X7R','X5R','C0G','NP0'].includes(cap.parameters['Temperature Coefficient']),'DECOUPLING_MLCC_UNCONFIRMED');
    const model=await a.jlc_eda_read_library_model({...t,kind:'footprint',view:'geometry',modelUuid:cap.footprint.uuid,libraryUuid:cap.footprint.libraryUuid});
    requireState(model.status==='ok'&&equal(model.geometry.pads.map(x=>x.padNumber).sort(),['1','2']),'DECOUPLING_TWO_PADS_REQUIRED');
    const symbol=await a.jlc_eda_read_library_model({...t,kind:'symbol',view:'geometry',modelUuid:cap.symbol.uuid,libraryUuid:cap.symbol.libraryUuid});
    requireState(symbol.status==='ok'&&equal(symbol.geometry.pins.map(x=>x.pinNumber).sort(),['1','2']),'DECOUPLING_TWO_SYMBOL_PINS_REQUIRED');
    if(d.cap.pose.rotation===0&&!d.cap.pose.mirror){
      const pins=symbol.geometry.pins.map(pin=>({number:pin.pinNumber,x:d.cap.pose.x+pin.x,y:d.cap.pose.y+pin.y,rotation:pin.rotation}));
      const doc=prev.schematicVerification.document;
      planJunctions(circuit,{...doc,components:[...doc.components,{id:d.cap.ref,uniqueId:d.cap.ref,pins}]});
    }
    const beforeSch=await capture(a,t,'schematic'),beforePcb=await capture(a,t,'pcb');
    requireState(equal(archiveDesignFingerprint(beforeSch),history.finish.design.schematic)&&equal(archiveDesignFingerprint(beforePcb),history.finish.design.pcb),'DECOUPLING_BASELINE_ARCHIVE_MISMATCH');
    r.decoupling={circuit,beforeSch,beforePcb};await persist(dir,r);
    return {status:'ok',delta:d,device:cap,footprintGeometry:model,symbolGeometry:symbol,supplyPin:d.pin};
  }
  requireState(r.decoupling,'DECOUPLING_PLAN_REQUIRED');
  if(p.phase==='schematic'){
    if(r.decoupling.schematicVerified)return {status:'ok',reused:true,design:r.decoupling.schDesign};
    const ctx=await bound(a,t);
    ctx.r.actions['decoupling/stage']??={state:'pending'};await persist(dir,ctx.r);
    return applySchematic(a,t,ctx,ctx.r.decoupling,d);
  }
  requireState(['sync','verify_sync'].includes(p.phase)&&r.decoupling.schematicVerified,'DECOUPLING_VERIFIED_SCHEMATIC_REQUIRED');
  if(r.decoupling.completed && p.phase==='sync')return {status:'ok',reused:true,completed:true};
  const ctx=await pcbBound(a,t),st=ctx.r.decoupling;ctx.r.pcbSyncActions??={};
  let op=ctx.r.pcbSyncActions[t.requestId];
  if(!op){
    requireState(p.phase==='sync','DECOUPLING_NO_PRIOR_IMPORT');
    const sch=await capture(a,t,'schematic'),pcb=await capture(a,t,'pcb');
    requireState(equal(archiveDesignFingerprint(sch),st.schDesign)&&equal(archiveDesignFingerprint(pcb),archiveDesignFingerprint(st.beforePcb)),'DECOUPLING_TARGET_CHANGED_BEFORE_IMPORT');
    op={state:'pending',importMode:'unrouted_decoupling',startedAt:new Date().toISOString()};
    ctx.r.pcbSyncActions[t.requestId]=op;await persist(dir,ctx.r);
    op.nativeImport=await a.invoke(t.sessionId,pcbScript({...t,operation:'import',importMode:'unrouted_decoupling',priorIds:ctx.r.pcbSyncBaseline.after.components.map(x=>x.id)}));
    op.state='unknown';await persist(dir,ctx.r);
  }
  return verifySync(a,t,ctx,st,d);
}
