import {z} from 'zod';import {readFile} from 'node:fs/promises';import path from 'node:path';
import {fingerprint} from './drawing.mjs';import {digest} from './facts.mjs';import {load,persist} from './workflow.mjs';
import {pcbBound,pcbSnapshot,comparePreservedPcbSnapshot} from './pcb.mjs';import {readOwnedRouting,compareRoutingCheckpoint,routingScript} from './p3.mjs';
import {readNativeEvidence,losslessView} from './file-checkpoint.mjs';import {reconcileStageApiProjection} from './stage-api-projection.mjs';
import {selectKnownPartialStage} from './known-partial-stage.mjs';import {planRepair} from './repair-geometry.mjs';
import {compareRepairKeep} from './repair-preservation.mjs';
import {verifyLayoutSnapshot,unresolvedActions} from './pcb-validation.mjs';import {compareRulesWithEvidence} from './native-rule-evidence.mjs';import {ruleCheckpointEqual} from './rules.mjs';import {auditCopper} from './copper.mjs';
import {unzipSync,strFromU8} from 'fflate';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/),endpoint=z.object({uniqueId:id,pin:z.string().min(1)}).strict(),point=z.array(z.number().finite()).length(2);
const p3Target={sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,schematicUuid:id,pcbDocumentUuid:id,workDirectory:z.string().min(1).max(4096)};
export const repairSchemas={jlc_eda_repair_pcb:z.object({...p3Target,requestId:id,phase:z.enum(['plan','apply','verify','verify_returned']),net:z.string().min(1),from:endpoint,to:endpoint,unit:z.enum(['mm','mil']).default('mm'),paths:z.array(z.object({layer:z.union([z.literal(1),z.literal(2)]),width:z.number().positive().finite(),points:z.array(point).min(2).max(30)}).strict()).min(1).max(8),vias:z.array(z.object({at:point,holeDiameter:z.number().positive().finite(),diameter:z.number().positive().finite()}).strict()).max(12).default([]),purpose:z.string().min(10).max(1000)}).strict()};
const fail=code=>{throw Object.assign(Error(code),{code,status:'unknown'});};
const same=(a,b)=>fingerprint(a)===fingerprint(b);
export function nonCopperEvidence(data,documentUuid){
 const docs=[];let doc;
 for(const [name,bytes]of Object.entries(unzipSync(Buffer.from(data,'base64'))))if(name.endsWith('.epru'))for(const line of strFromU8(bytes).split('\n').filter(x=>x.trim())){const i=line.indexOf('||'),h=JSON.parse(line.slice(0,i)),b=JSON.parse(line.slice(i+2).replace(/\|$/,''));if(h.type==='DOCHEAD'){doc={uuid:b.uuid,docType:b.docType,records:[]};docs.push(doc);}else if(!(doc.uuid===documentUuid&&(['LINE','VIA'].includes(h.type)||h.type==='ELE_PLACEHOLDER'&&['LINE','VIA'].includes(b.dataType))))doc.records.push({type:h.type,id:h.id??null,body:b});}
 for(const d of docs)d.records.sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b)));docs.sort((a,b)=>a.uuid.localeCompare(b.uuid));return {sha256:fingerprint(docs),complete:true,scope:'Every native design record except this PCB LINE/VIA (separately exact) and native LINE/VIA allocation counters; DOCHEAD volatile metadata omitted'};
}
export async function verifyRepairSource(r){
 const s=r.continuation?.selectedStage;if(s?.kind!=='known_partial_file_stage'||r.path===s.sourcePath||r.pcbRepairBaseline?.predecessorFingerprint!==fingerprint(s))fail('REPAIR_PREDECESSOR_UNPROVEN');
 const file=r.continuation.sourceJournalCopy,bytes=await readFile(file);
 if(file!==path.join(path.dirname(r.path),'source-journal.json')||digest(bytes)!==s.sourceJournalSha256||digest(await readFile(s.sourcePath))!==s.sourceSha256||digest(await readFile(path.join(path.dirname(s.sourcePath),'work-project.json')))!==s.sourceJournalSha256||fingerprint(selectKnownPartialStage(JSON.parse(bytes),{sourcePath:s.sourcePath,sourceSha256:s.sourceSha256,sourceJournalSha256:s.sourceJournalSha256,intent:s.intent}))!==fingerprint(s)||fingerprint(r.fileRouteActions?.[s.actionKey])!==s.historicalActionFingerprint)fail('REPAIR_SOURCE_OR_HISTORY_CHANGED');
 return s;
}
export function reconcileRepairProjection({expected,actual,evidence,document,source,reference={native:expected,storedCopper:source.storedCopper}}){
 const stored=reference.storedCopper;
 if(!stored?.complete||fingerprint(stored.rows)!==stored.sha256||stored.rows.length!==reference.native.objects.length||reference.native.objects.some(x=>stored.rows.filter(r=>r.id===x.primitiveId).length!==1)||!evidence.copper?.complete||fingerprint(evidence.copper.rows)!==evidence.copper.sha256||evidence.padModels.sha256!==source.padModels.sha256)return {status:'mismatch',code:'REPAIR_STORED_COPPER_OR_MODELS_CHANGED'};
 const present=new Set(actual.objects.map(x=>x.primitiveId)),missing=reference.native.objects.filter(x=>!present.has(x.primitiveId)&&x.kind==='Line'&&Math.hypot(x.endX-x.startX,x.endY-x.startY)<=.1);
 for(const x of missing){const old=stored.rows.filter(r=>r.id===x.primitiveId),now=evidence.copper.rows.filter(r=>r.id===x.primitiveId);if(old.length!==1||now.length!==1||!same(old[0],now[0]))return {status:'mismatch',code:'REPAIR_MICRO_SOURCE_CHANGED'};}
 const physicalExpectation={...actual,objects:[...actual.objects,...missing]},ids=new Set(physicalExpectation.objects.map(x=>x.primitiveId));
 if(evidence.copper.rows.length!==ids.size||evidence.copper.rows.some(x=>!ids.has(x.id)))return {status:'mismatch',code:'REPAIR_API_RAW_COVERAGE_UNPROVEN'};
 const projection=reconcileStageApiProjection({expected:physicalExpectation,actual,storedBefore:evidence.copper,storedAfter:evidence.copper,archiveData:evidence.data,document});
 if(projection.status!=='matched')return projection;
 // Newly returned independent native objects must agree with their complete
 // stored geometry, not merely with the create receipt. Owned vias have their
 // separate full model/transform proof from readOwnedRouting/extractNativeCopper.
 const viaNominalProjections=[];
 for(const [index,x]of projection.native.objects.entries()){const row=evidence.copper.rows.find(r=>r.id===x.primitiveId),b=row.body;let y,api=x;
  if(row.type==='LINE')y={kind:'Line',primitiveId:row.id,net:b.netName,layer:b.layerId,startX:b.startX,startY:b.startY,endX:b.endX,endY:b.endY,lineWidth:b.width,primitiveLock:b.locked};
  if(row.type==='VIA'){
   y={kind:'Via',primitiveId:row.id,net:b.netName,x:b.centerX,y:b.centerY,diameter:b.viaDiameter,holeDiameter:b.holeDiameter,viaType:b.viaType==='NORMAL'?0:-1,primitiveLock:b.locked};
   const fields=[];for(const k of ['diameter','holeDiameter'])if(x[k]!==y[k]){const nominal=Math.round(y[k]/2*10+1e-10)/10*2;if(x[k]!==nominal)return {status:'mismatch',code:'REPAIR_VIA_SDK_PROJECTION_UNPROVEN',id:x.primitiveId,field:k};fields.push({field:k,stored:y[k],api:x[k],exactSdkNominal:nominal});}
   if(fields.length){api={...x,diameter:y.diameter,holeDiameter:y.holeDiameter};projection.native.objects[index]=api;viaNominalProjections.push({id:x.primitiveId,fields,sourceStoredCopperSha256:evidence.copper.sha256,strictApi:compareRoutingCheckpoint({...actual,objects:[y]},{...actual,objects:[x]},{compareRules:false}),method:'Installed official PCB_PrimitiveVia.getAll: tt(radius,1,false)*2, tt=round(radius*10+1e-10)/10. Complete stored geometry is used; no geometry tolerance widened.'});}
  }
  if(y&&compareRoutingCheckpoint({...actual,objects:[y]},{...actual,objects:[api]},{compareRules:false}).status!=='matched')return {status:'mismatch',code:'REPAIR_API_STORED_VALUE_MISMATCH',id:x.primitiveId};
 }
 const sourceKeep=compareRepairKeep(source.native,projection.native,{storedBefore:source.storedCopper,storedAfter:evidence.copper,splitNets:source.intent?.nets??[]});
 if(sourceKeep.status!=='matched')return {status:'mismatch',code:'REPAIR_SOURCE_PHYSICAL_CONTENT_CHANGED',sourceKeep};
 return {...projection,sourceKeep,viaNominalProjections,strictApi:compareRoutingCheckpoint(projection.native,actual,{compareRules:false}),sourceStageCount:reference.native.objects.length,repairSourceBound:true,stagePreservationOnly:false,routeQualificationGranted:false,qualification:'Explicit local-repair representation: API remains separate; only prior source/accepted raw-identical pad-contained micro lines supplement reads. Target LINE splitting needs exact coverage and unchanged metadata. DRC/graph/source/archives remain mandatory.'};
}
export async function readRepairSnapshot(adapter,p,r,{expected=r.pcbRepairBaseline.native,stored=r.pcbRepairBaseline.storedCopper,allowAdded=false,mutationNet=null}={}){
 const a=losslessView(adapter),s=await verifyRepairSource(r),actual=await readOwnedRouting(a,p),document=await a.jlc_eda_read_document({sessionId:p.sessionId,expectedProjectUuid:p.expectedProjectUuid,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
 if(r.kind!=='continuation_pending'&&!r.pcbRepairBaseline.nonCopper?.complete)fail('REPAIR_NON_COPPER_BASELINE_REQUIRED');
 if(actual.status!=='ok'||document.status!=='ok'||document.truncated!==false)fail('REPAIR_READ_INCOMPLETE');
 const evidence=await readNativeEvidence(a,p,{native:actual,document}),projection=reconcileRepairProjection({expected,actual,evidence,document,source:s,reference:{native:expected,storedCopper:stored}}),native=projection.native??actual;
 const components=comparePreservedPcbSnapshot({...s.document,counts:document.counts},pcbSnapshot(document),{expectedProjectUuid:s.sourceProjectUuid,actualProjectUuid:p.expectedProjectUuid}),layout=verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,document,native,r.pcbLayoutBaseline.outline),rules=compareRulesWithEvidence(r.pcbRepairBaseline.native.ruleConfiguration,actual.ruleConfiguration,{expectedNative:s.nativeRules,actualNative:evidence.rules,allowProjection:true}),nonCopper=nonCopperEvidence(evidence.data,p.pcbDocumentUuid);
 const currentKeep=compareRepairKeep(expected,native,{storedBefore:stored,storedAfter:evidence.copper,splitNets:mutationNet?[mutationNet]:[]}),storedMatched=currentKeep.status==='matched'&&(allowAdded||stored.sha256===evidence.copper.sha256&&compareRoutingCheckpoint(expected,native,{compareRules:false}).status==='matched');
 const issues=[];for(const [name,v]of Object.entries({projection,components,layout,rules}))if(v.status!=='matched')issues.push({code:'REPAIR_'+name.toUpperCase()+'_MISMATCH',detail:v.code??v.issues});
 if(!storedMatched)issues.push({code:'REPAIR_CURRENT_RAW_BASELINE_CHANGED'});
 if(r.pcbRepairBaseline.nonCopper&&r.pcbRepairBaseline.nonCopper.sha256!==nonCopper.sha256)issues.push({code:'REPAIR_NON_COPPER_CHANGED'});
 return {status:issues.length?'unknown':'ok',comparison:{status:issues.length?'mismatch':'matched',issues},native,apiNative:actual,apiProjection:projection,currentKeep,strictOriginalIds:compareRoutingCheckpoint(expected,actual,{compareRules:false}),document,components,layout,rules,rulesMatched:rules.status==='matched',storedCopper:evidence.copper,padModels:evidence.padModels,nativeRules:evidence.rules,design:evidence.design,nonCopper};
}
export async function verifyRepairCheckpoint(adapter,p,r){
 const a=losslessView(adapter),identity=await a.jlc_eda_verify_pcb({...p,circuit:r.circuit});if(identity.status!=='ok'||identity.comparison?.status!=='matched')return {...identity,boardReady:false};
 const before=await readRepairSnapshot(a,p,r),drc=await a.invoke(p.sessionId,routingScript({...p,operation:'check'}),60000),after=await readRepairSnapshot(a,p,r),stable=before.status==='ok'&&after.status==='ok'&&before.design.sha256===after.design.sha256&&same(pcbSnapshot(before.document),pcbSnapshot(after.document))&&compareRoutingCheckpoint(before.native,after.native,{compareRules:false}).status==='matched',copper=auditCopper(after.document,after.native),drcPassed=drc.status==='ok'&&drc.strict===true&&Array.isArray(drc.errors)&&drc.errors.length===0&&ruleCheckpointEqual(drc.beforeRules,drc.afterRules)&&ruleCheckpointEqual(after.apiNative.ruleConfiguration,drc.afterRules),unresolved=unresolvedActions(r),issues=[...before.comparison.issues,...after.comparison.issues];
 if(!stable)issues.push({code:'REPAIR_CHECK_DESIGN_NOT_STABLE'});if(!drcPassed)issues.push({code:'REPAIR_STRICT_DRC_FAILED'});if(!copper.fullyConnected)issues.push({code:'REPAIR_COPPER_NOT_CONNECTED'});if(unresolved.length)issues.push({code:'REPAIR_ACTION_UNRESOLVED',actions:unresolved});
 return {...after,status:'ok',identity,drc,drcPassed,copper,stable,unresolvedActions:unresolved,comparison:{status:issues.length?'mismatch':'matched',issues},boardReady:issues.length===0,designReady:issues.length===0,checkBasis:'explicit known-partial local repair, exact stored content and source/model/rules, strict API diagnostics separate, fresh strict DRC and actual copper graph; no file success/replay'};
}
async function nativeRepair(p){
 const matches=async()=>{const project=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();return project?.uuid===p.expectedProjectUuid&&doc?.uuid===p.pcbDocumentUuid&&doc.parentProjectUuid===p.expectedProjectUuid&&doc.documentType===3&&project.data?.filter(x=>x.itemType==='Board'&&x.pcb?.uuid===p.pcbDocumentUuid&&x.schematic?.uuid===p.schematicUuid&&x.schematic.page?.some(y=>y.uuid===p.schematicPageUuid)).length===1;};
 const log=[];for(const [i,o]of p.objects.entries()){
  if(!await matches())return {status:'unknown',code:'REPAIR_TARGET_CHANGED',log};
  const x=o.kind==='Line'?await eda.pcb_PrimitiveLine.create(o.net,o.layer,o.startX,o.startY,o.endX,o.endY,o.lineWidth,true):await eda.pcb_PrimitiveVia.create(o.net,o.x,o.y,o.holeDiameter,o.diameter,0,undefined,undefined,true);
  if(!x)return {status:'unknown',code:'REPAIR_CREATE_UNCONFIRMED',log};
  const actual={kind:o.kind};for(const k of ['PrimitiveId','Net','Layer','StartX','StartY','EndX','EndY','LineWidth','X','Y','Diameter','HoleDiameter','ViaType','PrimitiveLock']){const f=x['getState_'+k];if(typeof f==='function')actual[k[0].toLowerCase()+k.slice(1)]=f.call(x)??null;}
  log.push({index:i,actual});
 }
 return {status:await matches()?'ok':'unknown',log,sourceApi:'official pcb_PrimitiveLine.create / pcb_PrimitiveVia.create; no routing engine'};
}
export const repairScript=p=>'('+nativeRepair.toString()+')('+JSON.stringify(p)+')';
export function repairRequestMatches(action,input,phase,r){
 if(action.hash===fingerprint(input))return true;
 const stable=x=>Object.fromEntries(Object.entries(x).filter(([k])=>!['sessionId','expectedProjectUuid'].includes(k)));
 return phase==='verify'&&action.state==='completed'&&same(stable(action.input),stable(input))&&Object.values(r.contextRefreshes??{}).some(x=>x.state==='completed'&&x.closed?.status==='ok'&&x.closed.sessionNoLongerAlive===true&&x.closed.editorWindowDestroyed===true&&x.target?.path===r.path&&x.target.sessionId===action.input.sessionId&&x.target.projectUuid===action.input.expectedProjectUuid&&x.newBinding?.sessionId===input.sessionId&&x.newBinding.projectUuid===input.expectedProjectUuid&&x.verification?.boardReady===true&&same(x.before,x.fullDesign));
}
export const repairWorkflow={async jlc_eda_repair_pcb(p){
 const a=losslessView(this),{dir,r}=await pcbBound(a,p);await verifyRepairSource(r);r.pcbRepairActions??={};let action=r.pcbRepairActions[p.requestId];const {phase,...input}=p,hash=fingerprint(input);
 if(action&&!repairRequestMatches(action,input,p.phase,r))return {status:'failed',code:'REPAIR_REQUEST_CONFLICT'};
 if(action?.state==='invalidated'){
  if(p.phase!=='verify_returned'||action.after||action.applyAttempts!==1||action.nativeResult?.status!=='ok'||action.nativeResult.log?.length!==action.plan.objects.length||!action.failureReadbacks?.length||action.failureReadbacks.some(x=>x.comparison?.issues?.some(i=>!['REPAIR_PROJECTION_MISMATCH','REPAIR_CURRENT_RAW_BASELINE_CHANGED','REPAIR_CREATED_SCOPE_OR_COVERAGE_CHANGED'].includes(i.code))))return {status:'unknown',code:'REPAIR_INVALIDATED_NO_REPLAY',nativeMutationReplayed:false};
  action.readRepresentationRecovery??={previousState:action.state,firstFailureFingerprints:action.failureReadbacks.map(fingerprint),at:new Date().toISOString(),method:'Explicit read-only verification of returned native creation; no accepted observation existed and no native replay'};action.readRepresentationRecovery.reads??=[];action.readRepresentationRecovery.reads.push({failureFingerprints:action.failureReadbacks.map(fingerprint),at:new Date().toISOString()});action.state='unknown';await persist(dir,r);
 }
 if(!action){
  if(p.phase!=='plan')return {status:'failed',code:'REPAIR_PLAN_REQUIRED'};
  if(unresolvedActions(r).length)return {status:'unknown',code:'REPAIR_OTHER_ACTION_UNRESOLVED'};
  const before=await readRepairSnapshot(a,p,r);if(before.status!=='ok')return before;
  const plan=planRepair(p,before.document,before.native,r);if(plan.status!=='matched')return {...plan,status:'failed',code:'REPAIR_PLAN_REJECTED',nativeMutationRequested:false};
  const combined={...before.native,objects:[...before.native.objects,...plan.objects]},graph=auditCopper(before.document,combined),get=e=>graph.nets.find(x=>x.net===p.net)?.connectedGroups.findIndex(g=>g.some(x=>x.component===e.uniqueId&&x.number===e.pin));
  if(get(p.from)<0||get(p.from)!==get(p.to))return {status:'failed',code:'REPAIR_PATH_ENDPOINTS_NOT_CONNECTED',graph,nativeMutationRequested:false};
  action={hash,state:'planned',input,plan,before,applyAttempts:0,at:new Date().toISOString()};r.pcbRepairActions[p.requestId]=action;await persist(dir,r);return {status:'ok',plan,graph,nativeMutationRequested:false};
 }
 if(p.phase==='plan')return {status:'ok',plan:action.plan,reused:true,nativeMutationRequested:false};
 if(p.phase==='apply'&&action.state==='planned'){
  const other=unresolvedActions(r).filter(x=>!(x.scope==='repair'&&x.key===p.requestId));if(other.length)return {status:'unknown',code:'REPAIR_OTHER_ACTION_UNRESOLVED'};
  const before=await readRepairSnapshot(a,p,r);if(before.status!=='ok'||before.design.sha256!==action.before.design.sha256||compareRoutingCheckpoint(action.before.native,before.native,{compareRules:false}).status!=='matched')return {status:'unknown',code:'REPAIR_PLAN_SOURCE_CHANGED',before};
  action.state='pending';action.applyAttempts=1;await persist(dir,r);
  try{action.nativeResult=await a.invoke(p.sessionId,repairScript({...p,objects:action.plan.objects}),60000);}catch(error){action.error={code:error.code,message:error.message};}
  action.state='unknown';await persist(dir,r);
 }
 if(action.state==='planned')return {status:'unknown',code:'REPAIR_NOT_APPLIED',nativeMutationReplayed:false};
 const log=action.nativeResult?.log;
 if(action.applyAttempts!==1||action.nativeResult?.status!=='ok'||log?.length!==action.plan.objects.length)return {status:'unknown',code:'REPAIR_NATIVE_OUTCOME_UNKNOWN',action,nativeMutationReplayed:false};
 const objects=log.map((x,i)=>{if(x.index!==i)fail('REPAIR_LOG_ORDER_CHANGED');const want={...action.plan.objects[i],primitiveId:x.actual.primitiveId};if(compareRoutingCheckpoint({...action.before.native,objects:[want]},{...action.before.native,objects:[x.actual]},{compareRules:false}).status!=='matched')fail('REPAIR_CREATED_GEOMETRY_CHANGED');return x.actual;});
 const expected=action.state==='completed'?r.pcbRepairBaseline.native:action.before.native,read=await readRepairSnapshot(a,p,r,{expected,stored:action.state==='completed'?r.pcbRepairBaseline.storedCopper:action.before.storedCopper,allowAdded:action.state!=='completed',mutationNet:action.state==='completed'?null:p.net});
 const createdKeep=read.native?compareRepairKeep({...expected,objects},read.native,{splitNets:[p.net]}):{status:'mismatch'},oldMapped=new Set(read.currentKeep?.mapping.flatMap(x=>x.newIds)??[]),createdMapped=new Set(createdKeep.mapping?.flatMap(x=>x.newIds)??[]);
 if(createdKeep.status!=='matched'||action.state!=='completed'&&read.native.objects.some(x=>!oldMapped.has(x.primitiveId)&&!createdMapped.has(x.primitiveId))){read.status='unknown';read.comparison.issues.push({code:'REPAIR_CREATED_SCOPE_OR_COVERAGE_CHANGED',createdKeep});read.comparison.status='mismatch';}
 read.createdKeep=createdKeep;
 if(action.state!=='completed'&&action.readRepresentationRecovery&&action.failureReadbacks.some(x=>x.storedCopper?.sha256!==read.storedCopper.sha256||x.design?.sha256!==read.design.sha256)){read.status='unknown';read.comparison.status='mismatch';read.comparison.issues.push({code:'REPAIR_RETURNED_RESULT_CHANGED'});}
 if(read.status!=='ok'){action.state='invalidated';action.failureReadbacks??=[];action.failureReadbacks.push(read);await persist(dir,r);return {...read,nativeMutationReplayed:false};}
 if(action.state!=='completed'){action.state='completed';action.after=read;r.pcbRepairBaseline={...r.pcbRepairBaseline,native:read.native,document:pcbSnapshot(read.document),storedCopper:read.storedCopper,padModels:read.padModels,nativeRules:read.nativeRules,nonCopper:read.nonCopper,sourceStage:false,latestRequestId:p.requestId};await persist(dir,r);}
 return {...read,nativeMutationReplayed:false,added:objects,applyAttempts:action.applyAttempts};
}};
