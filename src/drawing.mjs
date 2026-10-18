import{parseNativeSource}from'./native-records.mjs';
import { z } from 'zod';
import { unzipSync,strFromU8 } from 'fflate';
import { digest, compareAssignments } from './facts.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const label=z.string().trim().min(1).max(120);
const pose=z.object({x:z.number().finite(),y:z.number().finite(),rotation:z.union([z.literal(0),z.literal(90),z.literal(180),z.literal(270)]).default(0),mirror:z.boolean().default(false)}).strict();
const endpoint=z.object({ref:id,pin:label,stubLength:z.number().min(10).max(80).default(25)}).strict();
export const componentSchema=z.object({ref:id,designator:label,deviceUuid:id,libraryUuid:id,subPartName:label.optional(),pose,
  properties:z.record(z.string().max(400)).default({}),supplierId:label,manufacturerPart:label,footprintUuid:id}).strict();
export const circuitSchema=z.object({components:z.array(componentSchema).min(1).max(30),
  nets:z.array(z.object({name:label,endpoints:z.array(endpoint).min(1).max(100)}).strict()).min(1).max(100),
  nc:z.array(endpoint).default([]),notes:z.array(z.object({x:z.number().finite(),y:z.number().finite(),text:z.string().min(1).max(1000)}).strict()).max(10).default([])
}).strict().superRefine((v,c)=>{
  for(const key of ['ref','designator'])if(new Set(v.components.map(x=>x[key])).size!==v.components.length)c.addIssue({code:'custom',message:'Duplicate '+key});
  if(new Set(v.nets.map(x=>x.name)).size!==v.nets.length)c.addIssue({code:'custom',message:'Duplicate net name'});
  const refs=new Set(v.components.map(x=>x.ref)),used=new Set();
  for(const e of [...v.nets.flatMap(n=>n.endpoints),...v.nc]){const k=e.ref+'.'+e.pin;
    if(!refs.has(e.ref)||used.has(k))c.addIssue({code:'custom',message:'Unknown ref or duplicate endpoint '+k});used.add(k);}
});
const target={sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,workDirectory:z.string().min(1).max(4096)};
export const drawingSchemas={
  jlc_eda_create_work_project:z.object({outputDirectory:z.string().min(1).max(4096),blankTemplatePath:z.string().min(1).max(4096).optional(),requestId:id,
    projectImport:z.object({sourcePath:z.string().min(1).max(4096),sessionId:id,expectedProjectUuid:id}).strict().optional()
  }).strict().refine(p=>!!p.blankTemplatePath!==!!p.projectImport,'Choose a blank template or an isolated local project import.'),
  jlc_eda_draw_schematic:z.object({...target,requestId:id,phase:z.enum(['place','complete','tidy']).default('complete'),showTitleBlock:z.boolean().default(false),circuit:circuitSchema}).strict(),
  jlc_eda_verify_schematic:z.object({sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,circuit:circuitSchema}).strict(),
  jlc_eda_save_work_project:z.object({...target,requestId:id,pcbDocumentUuid:id.optional(),schematicUuid:id.optional()}).strict().refine(p=>!!p.pcbDocumentUuid===!!p.schematicUuid,'PCB save requires both pcbDocumentUuid and schematicUuid.'),
  jlc_eda_reopen_work_project:z.object({...target,circuit:circuitSchema}).strict(),
  jlc_eda_preview_schematic:z.object({...target,format:z.enum(['svg','png']).default('svg')}).strict()
};
export const fingerprint=v=>digest(JSON.stringify(v));
export function compareCircuit(circuit,netlist,doc){
  // Recompute the native identity/pin association against the final document, not an earlier read.
  const documentConnectivity=compareAssignments(netlist,[doc],null);
  const issues=[...documentConnectivity.issues],mismatches=[...documentConnectivity.mismatches],matched=[],actualByRef=new Map();
  for(const expected of circuit.components){
    const found=doc.components.filter(x=>x.designator===expected.designator);
    const logical=netlist.components.filter(x=>x.designator===expected.designator);
    if(!found.length||logical.length!==1){issues.push({code:'COMPONENT_IDENTITY_AMBIGUOUS_OR_MISSING',ref:expected.ref});continue;}
    const c=logical[0];
    const identityValid=c.uniqueId===expected.ref&&found.every(s=>s.uniqueId===c.uniqueId);
    if(c.uniqueId!==expected.ref)issues.push({code:'REQUEST_COMPONENT_ID_MISMATCH',ref:expected.ref,actual:c.uniqueId});
    for(const symbol of found)if(symbol.uniqueId!==c.uniqueId)issues.push({code:'SYMBOL_NETLIST_ID_MISMATCH',ref:expected.ref,symbolId:symbol.id,expected:c.uniqueId,actual:symbol.uniqueId});
    actualByRef.set(expected.ref,{c,symbols:found,identityValid});
    for(const [key,want] of Object.entries({supplierId:expected.supplierId,manufacturerPart:expected.manufacturerPart,footprintUuid:expected.footprintUuid}))
      if((key==='footprintUuid'?found[0].footprintSource?.uuid:c[key])!==want)mismatches.push({code:'METADATA_MISMATCH',ref:expected.ref,key,expected:want,actual:c[key]});
    for(const s of found){
      if(s.deviceSource?.uuid!==expected.deviceUuid||s.deviceSource?.libraryUuid!==expected.libraryUuid)mismatches.push({code:'DEVICE_REFERENCE_MISMATCH',ref:expected.ref,actual:s.deviceSource??s.device});
      for(const key of ['x','y','rotation','mirror'])if(s[key]!== (key==='rotation'?(360-expected.pose.rotation)%360:expected.pose[key]))mismatches.push({code:'POSE_MISMATCH',ref:expected.ref,key,actual:s[key],expected:expected.pose[key]});
      // Native Name is promoted out of OtherProperty into its dedicated state field.
      for(const [key,want] of Object.entries(expected.properties)){
        const actual=key==='Name'?s.name:s.properties?.[key];
        if(actual!==want)mismatches.push({code:'PROPERTY_MISMATCH',ref:expected.ref,key,actual,expected:want});
      }
    }
  }
  for(const c of netlist.components)if(!circuit.components.some(e=>e.designator===c.designator))mismatches.push({code:'EXTRA_COMPONENT',designator:c.designator});
  for(const symbol of doc.components)if(!circuit.components.some(e=>e.designator===symbol.designator))mismatches.push({code:'EXTRA_DOCUMENT_SYMBOL',symbolId:symbol.id,uniqueId:symbol.uniqueId,designator:symbol.designator});
  const assignments=[...circuit.nets.flatMap(n=>n.endpoints.map(e=>({...e,net:n.name,nc:false}))),...circuit.nc.map(e=>({...e,net:'',nc:true}))];
  const expectedPins=new Set(assignments.map(e=>e.ref+'.'+e.pin));
  for(const e of assignments){const group=actualByRef.get(e.ref),pins=group?.c.pins.filter(x=>x.number===e.pin)??[],symbols=group?.symbols.flatMap(x=>x.pins.filter(p=>p.number===e.pin))??[];
    if(!group?.identityValid||pins.length!==1||symbols.length!==1){issues.push({code:'PIN_MISSING_OR_AMBIGUOUS',...e});continue;}
    if(pins[0].net!==e.net||symbols[0].noConnected!==e.nc)mismatches.push({code:'PIN_ASSIGNMENT_MISMATCH',...e,actualNet:pins[0].net,actualNc:symbols[0].noConnected});
    else matched.push({...e,designator:group.c.designator});
  }
  for(const [ref,g] of actualByRef)for(const pin of g.c.pins)if(!expectedPins.has(ref+'.'+pin.number))mismatches.push({code:'UNSPECIFIED_PIN',ref,pin:pin.number});
  for(const [ref,g] of actualByRef)for(const symbol of g.symbols)for(const pin of symbol.pins)if(!expectedPins.has(ref+'.'+pin.number))mismatches.push({code:'UNSPECIFIED_DOCUMENT_PIN',ref,symbolId:symbol.id,pin:pin.number});
  if(doc.truncated!==false||doc.counts?.components!==doc.components.length)issues.push({code:'FINAL_DOCUMENT_COVERAGE_UNCERTAIN'});
  return {status:issues.length?'unknown':mismatches.length?'mismatch':'matched',matched,matchedPinAssignments:matched.length,mismatches,issues,documentConnectivity,
    coverage:{logical:true,metadata:true,pose:true,persistence:false,erc:false,electrical:false,physical:false}};
}
// A normal schematic_checked means native schematic association was checked without a PCB.
// Preserve known upstream problems even when the final expected-input comparison is clean.
export function mergeConnectivityComparison(comparison,upstream){
 const issues=[...comparison.issues],mismatches=[...comparison.mismatches];
 for(const issue of upstream?.issues??[])issues.push({...issue,source:'read_connectivity'});
 for(const mismatch of upstream?.mismatches??[])mismatches.push({...mismatch,source:'read_connectivity'});
 const upstreamUncertain=!upstream||!['matched','schematic_checked','mismatch'].includes(upstream.status);
 if(upstreamUncertain)issues.push({code:'UPSTREAM_CONNECTIVITY_UNCERTAIN',upstreamStatus:upstream?.status??null});
 const status=issues.length||comparison.status==='unknown'?'unknown':mismatches.length||upstream.status==='mismatch'||comparison.status==='mismatch'?'mismatch':'matched';
 return {...comparison,status,issues,mismatches,upstreamConnectivity:upstream??null};
}
// Serialized function; each call performs one bounded action and rechecks the exact native target.
async function nativeDraw(p){
  const project=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();
  const sameTarget=async()=>{const a=await eda.dmt_Project.getCurrentProjectInfo(),b=await eda.dmt_SelectControl.getCurrentDocumentInfo();return a?.uuid===p.expectedProjectUuid&&b?.uuid===p.schematicPageUuid&&b?.parentProjectUuid===p.expectedProjectUuid&&b.documentType===1;};
  const changed=()=>({status:'unknown',code:'TARGET_CHANGED_DURING_ACTION'});
  if(project?.uuid!==p.expectedProjectUuid||doc?.uuid!==p.schematicPageUuid||doc?.parentProjectUuid!==p.expectedProjectUuid||doc?.documentType!==1)return {status:'failed',code:'TARGET_MISMATCH'};
  const state=(x,k)=>typeof x?.[k]==='function'?x[k]():null;
  if(p.operation==='tidy'){
    // Only the completed draw journal supplies wire identities and original notes.
    // Resolve the entire bounded plan before any presentation-only mutation.
    const plan=[];
    for(const w of p.wires){
      const attrs=(await eda.sch_PrimitiveAttribute.getAll(w.wireId)).filter(a=>a.getState_Key()==='Name');
      if(attrs.length!==1||attrs[0].getState_Value()!==w.net)return {status:'failed',code:'TIDY_WIRE_SOURCE_MISMATCH'};
      if([90,270].includes(w.pin.rotation))plan.push({kind:'attribute',id:attrs[0].getState_PrimitiveId(),property:{x:w.pin.x+12,y:(w.pin.y+w.end.y)/2,rotation:0,alignMode:2}});
    }
    const texts=await eda.sch_PrimitiveText.getAll();
    for(const n of p.notes){
      const found=texts.filter(t=>t.getState_Content()===n.text&&t.getState_X()===n.x&&t.getState_Y()===n.y);
      if(found.length!==1)return {status:'failed',code:'TIDY_NOTE_SOURCE_MISMATCH'};
      plan.push({kind:'text',id:found[0].getState_PrimitiveId(),property:{x:n.toX,y:n.toY}});
    }
    for(const e of plan){
      if(!await sameTarget())return changed();
      const api=e.kind==='text'?eda.sch_PrimitiveText:eda.sch_PrimitiveAttribute;
      const updated=await api.modify(e.id,e.property);if(!updated)return {status:'unknown',code:'TIDY_MODIFY_UNCONFIRMED'};
      const read=await api.get(e.id);
      for(const [key,value] of Object.entries(e.property))if(state(read,'getState_'+key[0].toUpperCase()+key.slice(1))!==value)return {status:'unknown',code:'TIDY_READBACK_MISMATCH'};
    }
    return {status:'ok',plan};
  }
  if(p.operation==='title_block'){const r=await eda.dmt_Schematic.modifySchematicPageTitleBlock(p.showTitleBlock);return {status:r?'ok':'unknown'};}
  if(p.operation==='place'){
    const e=p.component,all=await eda.sch_PrimitiveComponent.getAll();
    if(all.some(c=>state(c,'getState_Designator')===e.designator))return {status:'unknown',code:'DESIGNATOR_ALREADY_PRESENT'};
    const device=await eda.lib_Device.get(e.deviceUuid,e.libraryUuid);
    if(!device||device.uuid!==e.deviceUuid)return {status:'failed',code:'DEVICE_NOT_FOUND'};
    if(!await sameTarget())return changed();
    const c=await eda.sch_PrimitiveComponent.create({uuid:e.deviceUuid,libraryUuid:e.libraryUuid,libraryType:'3'},e.pose.x,e.pose.y,e.subPartName,e.pose.rotation,e.pose.mirror,true,true);
    if(!c)return {status:'unknown',code:'CREATE_UNCONFIRMED'};
    const primitiveId=c.getState_PrimitiveId(),pre=(await eda.sch_PrimitiveComponent.get(primitiveId)).getState_OtherProperty();
    if(!await sameTarget())return changed();
    await eda.sch_PrimitiveComponent.modify(primitiveId,{designator:e.designator,uniqueId:e.ref,otherProperty:{...pre,...e.properties}});
    if(!await sameTarget())return changed();
    return {status:'ok',primitiveId};
  }
  if(p.operation==='connect'){
    const e=p.endpoint,cs=(await eda.sch_PrimitiveComponent.getAll()).filter(c=>state(c,'getState_Designator')===e.designator);
    if(cs.length!==1)return {status:'failed',code:'COMPONENT_AMBIGUOUS'};
    const pins=(await eda.sch_PrimitiveComponent.getAllPinsByPrimitiveId(cs[0].getState_PrimitiveId())).filter(x=>state(x,'getState_PinNumber')===e.pin);
    if(pins.length!==1)return {status:'failed',code:'PIN_AMBIGUOUS'};
    if(!await sameTarget())return changed();
    const pin=pins[0];if(p.nc){pin.setState_NoConnected(true);await pin.done();return {status:'ok',nc:true};}
    const x=pin.getState_X(),y=pin.getState_Y(),rotation=pin.getState_Rotation();
    const directions={0:[1,0],90:[0,1],180:[-1,0],270:[0,-1]},d=directions[rotation];
    if(!d)return {status:'unsupported',code:'PIN_DIRECTION_UNSUPPORTED',rotation};
    const end={x:x+d[0]*e.stubLength,y:y+d[1]*e.stubLength};
    const wire=await eda.sch_PrimitiveWire.create([x,y,end.x,end.y],p.net);
    if(!wire)return {status:'unknown',code:'WIRE_UNCONFIRMED'};
    if(!await sameTarget())return changed();
    const port=await eda.sch_PrimitiveComponent.createNetPort('BI',p.net,end.x,end.y,rotation,false);
    if(!port)return {status:'unknown',code:'LABEL_UNCONFIRMED'};
    if(!await sameTarget())return changed();
    return {status:'ok',pin:{x,y,rotation},end,wireId:wire.getState_PrimitiveId(),labelId:port.getState_PrimitiveId()};
  }
  if(p.operation==='note'){const r=await eda.sch_PrimitiveText.create(p.note.x,p.note.y,p.note.text,0,null,null,10);return {status:r?'ok':'unknown'};}
  if(p.operation==='archive'){
    const f=await eda.sys_FileManager.getDocumentFile('models');if(!f||f.size>2*1024*1024)return {status:'unknown',code:'ARCHIVE_UNAVAILABLE'};
    let s='';for(const b of new Uint8Array(await f.arrayBuffer()))s+=String.fromCharCode(b);if(!await sameTarget())return changed();return {status:'ok',data:btoa(s)};
  }
  if(p.operation==='save')return {status:'unknown',nativeSaveResult:await eda.sch_Document.save(),code:'PERSISTENCE_NOT_VERIFIED',nextAction:'Call reopen_work_project to verify disk contents. If it mismatches, save this exact task window using native UI and verify again.'};
  if(p.operation==='preview'){
    const file=p.format==='png'?await eda.sch_ManufactureData.getPngFile('schematic',{width:2000}):await eda.sch_ManufactureData.getSvgFile('schematic');
    if(!file)return {status:'needs_ui',code:'PREVIEW_REQUIRES_UI'};
    if(p.format==='png'){let s='';for(const b of new Uint8Array(await file.arrayBuffer()))s+=String.fromCharCode(b);if(!await sameTarget())return changed();return {status:'ok',data:btoa(s)};}
    return {status:'ok',source:await file.text()};
  }
  return {status:'failed',code:'UNKNOWN_DRAW_OPERATION'};
}
export const drawingScript=p=>'('+nativeDraw.toString()+')('+JSON.stringify(p)+')';

export function enrichModelSources(doc,data){
 const files=unzipSync(Buffer.from(data,'base64')),models=new Map();
 for(const [name,bytes] of Object.entries(files)){if(!name.endsWith('.epru'))continue;let head;
  for(const {header,body,deleted}of parseNativeSource(strFromU8(bytes))){if(deleted)continue;
   if(header.type==='DOCHEAD')head=body;
   if(header.type==='META'&&head&&['DEVICE','FOOTPRINT','SYMBOL'].includes(head.docType)){
    const [uuid,libraryUuid]=(body.source??'').split('|');models.set(head.uuid,{uuid,libraryUuid,title:body.title,kind:head.docType});}
  }
 }
 // The installed PCB API can return Component.uuid as a native reference object,
 // despite the SDK declaring a string. Resolve its actual uuid, retaining raw state.
 for(const c of doc.components){const deviceUuid=typeof c.device?.uuid==='string'?c.device.uuid:c.device?.uuid?.uuid;
  c.deviceSource=models.get(deviceUuid)??null;c.footprintSource=models.get(c.footprint?.uuid)??null;c.symbolSource=models.get(c.symbol?.uuid)??null;}
 return doc;
}
