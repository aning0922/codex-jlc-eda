import{passiveDeletionPlaceholders}from'./passive-allocations.mjs';
import {archiveSources} from './incremental-source.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {preserveArchive} from './eco-preservation.mjs';
import {fingerprint} from './drawing.mjs';
// Raw native replacement may serialize the same orthogonal transform with a
// signed angle. Exact multiples only: no geometric tolerance or arbitrary turns.
export const exactReplacementAngle=(a,b)=>[a,b].every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<=360&&v%90===0)&&((a-b)%360===0);
export function restoredPassiveComponent(target,actual){const expected={...target.componentBefore,locked:target.locked};if(exactReplacementAngle(expected.angle,actual?.angle))expected.angle=actual.angle;return expected;}
const canonical=x=>Array.isArray(x)?x.map(canonical):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,canonical(x[k])])):x;
const jsonEqual=(a,b)=>{try{return fingerprint(canonical(JSON.parse(a)))===fingerprint(canonical(JSON.parse(b)));}catch{return false;}};
export function preservedPassivePcb(record,state,data,{includeLocal=false}={}){
 const sources=archiveSources(record.baseline.data),current=archiveSources(data),old=sources.get(record.pcbDocumentUuid).rows,now=current.get(record.pcbDocumentUuid).rows,docs=nativeModelRecords(data),edits=[],mappings=[],tombstones=[],targets=[],issues=[];
 const map=(type,oldId,newId)=>{if(oldId!==newId)mappings.push({uuid:record.pcbDocumentUuid,type,oldId,newId});};
 for(const t of state.plan.targets){
  const oldId=t.oldPcb.id,source=old.find(r=>r.header.type==='COMPONENT'&&r.header.id===oldId),found=now.filter(r=>r.header.type==='COMPONENT'&&r.body.attrs?.['Unique ID']===t.uniqueId);
  if(found.length!==1){issues.push({code:'PASSIVE_PCB_UNIQUE_ID_AMBIGUOUS',ref:t.input.designator});continue;}
  const actual=found[0],newId=actual.header.id,proof=state.replacements[t.input.designator],deviceId=proof.deviceId,values={...t.model.part.parameters,Device:deviceId,Footprint:t.oldPcb.footprint.uuid,Designator:t.input.designator};
  if(docs.get(deviceId)?.rows.find(r=>r.type==='META')?.body.source!==t.model.part.uuid+'|'+t.model.part.libraryUuid)issues.push({code:'PASSIVE_PCB_ACTUAL_DEVICE_SOURCE_CHANGED',ref:t.input.designator});
  map('COMPONENT',oldId,newId);
  const attrs={...source.body.attrs},oldDevice=old.find(r=>r.header.type==='ATTR'&&r.body.parentId===oldId&&r.body.key==='Device')?.body.value,alternatives=JSON.parse(attrs.Devices??'[]');
  if(!alternatives.some(v=>v.uuid===oldDevice))alternatives.push({name:t.oldPcb.manufacturerPart,source:'',uuid:oldDevice});
  const expectedMetadata={DeviceName:JSON.stringify({name:t.model.part.manufacturerPart,source:'',uuid:deviceId}),Devices:JSON.stringify(alternatives)};
  for(const[k,v]of Object.entries(actual.body.attrs??{}))if(JSON.stringify(v)!==JSON.stringify(attrs[k])){if(expectedMetadata[k]!==undefined&&jsonEqual(v,expectedMetadata[k]))attrs[k]=v;else if(values[k]!==undefined&&String(v)===String(values[k]))attrs[k]=v;else issues.push({code:'PASSIVE_PCB_METADATA_OUTSIDE_CANDIDATE',ref:t.input.designator,key:k});}
  const pinSwapInfo=Object.fromEntries(Object.entries(source.body.pinSwapInfo??{}).map(([k,v])=>[k.startsWith(oldId)?newId+k.slice(oldId.length):k,v]));
  // Observed native replacement creates an unlocked target; completion restores
  // the original lock. Only the declared target can use the exact equivalent
  // orthogonal angle representation; position, layer and all model geometry stay exact.
  const expected={...source.body,attrs,pinSwapInfo};if(exactReplacementAngle(source.body.angle,actual.body.angle))expected.angle=actual.body.angle;if(!includeLocal&&actual.body.locked===false)expected.locked=false;
  edits.push({type:'COMPONENT',id:oldId,after:expected});
  const attributes=[];
  for(const row of old.filter(r=>r.header.type==='ATTR'&&r.body.parentId===oldId)){
   const candidates=now.filter(r=>r.header.type==='ATTR'&&r.body.parentId===newId&&r.body.key===row.body.key);
   if(candidates.length!==1){issues.push({code:'PASSIVE_PCB_ATTRIBUTE_MAPPING_AMBIGUOUS',ref:t.input.designator,key:row.body.key});continue;}
   const n=candidates[0];map('ATTR',row.header.id,n.header.id);const body={...row.body,parentId:newId};
   if(n.body.value!==body.value){if(values[row.body.key]!==undefined&&String(values[row.body.key])===String(n.body.value))body.value=n.body.value;else issues.push({code:'PASSIVE_PCB_ATTRIBUTE_VALUE_UNPLANNED',ref:t.input.designator,key:row.body.key});}
   if(!includeLocal&&row.body.key==='Designator'&&n.body.fontSize===45)body.fontSize=45;
   edits.push({type:'ATTR',id:row.header.id,after:body});attributes.push({oldId:row.header.id,newId:n.header.id,key:row.body.key,original:row.body,imported:n.body});
  }
  for(const row of old.filter(r=>r.header.type==='PAD_NET'&&JSON.parse(r.header.id)[1]===oldId)){
   const id=JSON.parse(row.header.id),number=id[2];id[1]=newId;const newKey=JSON.stringify(id);map('PAD_NET',row.header.id,newKey);if(oldId!==newId)tombstones.push({uuid:record.pcbDocumentUuid,type:'PAD_NET',id:row.header.id});
   const body={...row.body};if(t.input.reconnect?.pin===number)body.padNet=t.input.reconnect.newNet;edits.push({type:'PAD_NET',id:row.header.id,after:body});
  }
  targets.push({ref:t.input.designator,uniqueId:t.uniqueId,oldId,newId,primitiveIdChanged:oldId!==newId,angleRepresentation:source.body.angle!==actual.body.angle&&exactReplacementAngle(source.body.angle,actual.body.angle)?{before:source.body.angle,after:actual.body.angle,qualification:'Exact equivalent orthogonal transform on the declared replaced instance only'}:null,original:source.body,imported:actual.body,attributes});
 }
 const newModels=state.plan.targets.flatMap(t=>state.replacements[t.input.designator].allowedNewModels),created=includeLocal?state.local.operations.flatMap((o,i)=>o.kind.startsWith('NEW_')?[state.steps['local/'+i]?.result?.primitiveId]:[]):[];
 if(includeLocal)edits.push(...state.plan.targets.flatMap(t=>t.removeOperations??[]).map(o=>({type:'LINE',id:o.id,after:null})));
 const allocators=passiveDeletionPlaceholders(old,now,{COMPONENT:mappings.filter(m=>m.type==='COMPONENT').length,ATTR:mappings.filter(m=>m.type==='ATTR').length,LINE:includeLocal?state.plan.targets.flatMap(t=>t.removeOperations??[]).length:0},record.pcbDocumentUuid);issues.push(...allocators.issues);mappings.push(...allocators.recordMappings);const allocatorIds=allocators.newIds;
 const preservation=preserveArchive(record.baseline.data,data,{mainUuid:record.pcbDocumentUuid,edits,recordMappings:mappings,allowedTombstones:tombstones,allowNewModels:newModels,newIds:[...created,...allocatorIds],modelViewChanges:state.modelViewChanges??state.plan.targets.flatMap(t=>state.replacements[t.input.designator].modelViewChanges??[])});
 issues.push(...preservation.issues);return{status:issues.length?'mismatch':'matched',issues,preservation,targets,recordMappings:mappings,allowedTombstones:tombstones,allocators,temporaryImportNormalization:includeLocal?false:'Only observed unlocked target and default Designator fontSize=45; original lock/font mandatory at final verification',qualification:'Exact semantic uniqueId mapping of only declared replaced PCB components, attributes and pad bindings; all non-target records/copper/rules and full retained models remain exact.'};
}
