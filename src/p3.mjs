import {z} from 'zod';
import {realpath} from 'node:fs/promises';
import {invalidateRouteObservation,guiParameterCoverage} from './route-state.mjs';
import {proveFootprintVias,isOwnedFootprintVia,compareMovedFootprintVias} from './footprint-vias.mjs';
import {pcbBound,pcbSnapshot,positionDiff} from './pcb.mjs';
import {scripts} from './native-scripts.mjs';
import {persist,load} from './workflow.mjs';
import {fingerprint,circuitSchema} from './drawing.mjs';
import {verifyLayoutSnapshot,verifyAddedCopper,unresolvedActions} from './pcb-validation.mjs';
import {auditCopper} from './copper.mjs';
import {compareNativeDrc} from './drc-comparison.mjs';
import {rulesSchema,configureRules,ruleCheckpointEqual} from './rules.mjs';
import {verifyAcceptedFileRoute,fileCheckBasis,losslessView} from './file-checkpoint.mjs';
import {verifyRepairCheckpoint} from './local-repair.mjs';
import {layoutSchema,planLayout,checkLayout,toMil} from './layout.mjs';
import {controlledLayout} from './layout-candidate.mjs';
import {capturePlacementArchives,comparePlacementArchives} from './placement-evidence.mjs';
import {compareRouteArchives} from './route-archive-evidence.mjs';
const id=z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
export const p3Target={sessionId:id,expectedProjectUuid:id,schematicPageUuid:id,schematicUuid:id,pcbDocumentUuid:id,workDirectory:z.string().min(1).max(4096)};
export const p3Schemas={
 jlc_eda_read_pcb_routing:z.object({...p3Target}).strict(),
 jlc_eda_layout_pcb:z.object({...p3Target,requestId:id,layout:layoutSchema,strategy:z.enum(['manual','auto_candidate','adjust']).default('manual'),phase:z.enum(['plan','apply','verify','retry_rejected']).default('plan')}).strict(),
 jlc_eda_configure_pcb_rules:z.object({...p3Target,requestId:id,rules:rulesSchema,phase:z.enum(['apply','verify','prepare_ui','verify_ui','auto_recover','verify_auto','cleanup']).default('apply'),uiProfileName:z.string().min(1).max(100).optional()}).strict(),
 jlc_eda_route_pcb:z.object({...p3Target,requestId:id,phase:z.enum(['critical','native','prepare_ui','verify','retry_rejected','prepare_restore_undo']),guiParameterPolicy:z.enum(['require_all','allow_unverified']).default('require_all'),unit:z.enum(['mm','mil']).default('mm'),critical:z.object({net:z.string().min(1),from:z.object({uniqueId:id,pin:z.string().min(1)}).strict(),to:z.object({uniqueId:id,pin:z.string().min(1)}).strict(),waypoints:z.array(z.array(z.number().finite()).length(2)).max(30).default([]),layer:z.union([z.literal(1),z.literal(2)]),width:z.number().positive().finite()}).strict().optional(),routing:z.object({nets:z.array(z.string().min(1)).min(1).max(100),ignoreNets:z.array(z.string()).default([]),layers:z.array(z.union([z.literal(1),z.literal(2)])).min(1).max(2),existingPrimitiveMode:z.literal('keep'),cornerStyle:z.union([z.literal(0),z.literal(1)]),optimization:z.union([z.literal(0),z.literal(1)]),waitMs:z.number().int().min(30000).max(180000)}).strict().optional()}).strict(),
 jlc_eda_check_pcb:z.object({...p3Target,circuit:circuitSchema}).strict()
};
async function nativeRouting(p){
 const matches=async()=>{const project=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();return project?.uuid===p.expectedProjectUuid&&doc?.uuid===p.pcbDocumentUuid&&doc?.parentProjectUuid===p.expectedProjectUuid&&doc?.documentType===3&&project?.data?.filter(x=>x.itemType==='Board'&&x.pcb?.uuid===p.pcbDocumentUuid&&x.schematic?.uuid===p.schematicUuid&&x.schematic.page?.some(y=>y.uuid===p.schematicPageUuid)).length===1;};
 if(!await matches())return {status:'failed',code:'P3_TARGET_MISMATCH'};
 const serialize=(x,kind)=>{const r={kind};for(const name of ['PrimitiveId','Net','Layer','StartX','StartY','EndX','EndY','LineWidth','X','Y','Diameter','HoleDiameter','ViaType','PrimitiveLock','Polygon','ArcAngle']){const f=x['getState_'+name];if(typeof f==='function'){let v=f.call(x);if(v&&typeof v==='object'&&typeof v.getSource==='function')v=v.getSource();r[name[0].toLowerCase()+name.slice(1)]=v??null;}}return r;};
 if(p.operation==='rules_scoped'||p.operation==='rules_cleanup'){
  const before=await eda.pcb_Drc.getCurrentRuleConfiguration(),profiles=await eda.pcb_Drc.getAllRuleConfigurations(false),defaultProfile=await eda.pcb_Drc.getDefaultRuleConfigurationName()??null;
  if(JSON.stringify(before)!==JSON.stringify(p.beforeRules)||JSON.stringify(profiles)!==JSON.stringify(p.beforeProfiles)||defaultProfile!==p.beforeDefault)return {status:'failed',code:'PCB_RULE_SCOPE_CHANGED_BEFORE_WRITE',before,profiles,defaultProfile};
  if(p.operation==='rules_scoped'){
   const nativeResult=await eda.pcb_Drc.overwriteCurrentRuleConfiguration(p.afterRules.config);
   return {status:await matches()?'ok':'unknown',nativeResult:nativeResult??null,before,after:await eda.pcb_Drc.getCurrentRuleConfiguration(),beforeProfiles:profiles,afterProfiles:await eda.pcb_Drc.getAllRuleConfigurations(false),beforeDefault:defaultProfile,afterDefault:await eda.pcb_Drc.getDefaultRuleConfigurationName()??null,sourceApi:'eda.pcb_Drc.overwriteCurrentRuleConfiguration(config)'};
  }
  const deleted=[];for(const owned of p.ownedProfiles){
   if(!await matches())return {status:'unknown',code:'PCB_RULE_CLEANUP_TARGET_CHANGED',deleted};
   const current=await eda.pcb_Drc.getAllRuleConfigurations(false),found=current.filter(x=>x.name===owned.name);
   if(found.length!==1||JSON.stringify(found[0])!==JSON.stringify(owned))return {status:'failed',code:'PCB_OWNED_PROFILE_CHANGED',deleted};
   deleted.push({name:owned.name,nativeResult:await eda.pcb_Drc.deleteRuleConfiguration(owned.name)});
  }
  return {status:await matches()?'ok':'unknown',deleted,after:await eda.pcb_Drc.getCurrentRuleConfiguration(),afterProfiles:await eda.pcb_Drc.getAllRuleConfigurations(false),afterDefault:await eda.pcb_Drc.getDefaultRuleConfigurationName()??null};
 }
 if(p.operation==='rules'||p.operation==='rules_preflight'){
  const before=await eda.pcb_Drc.getCurrentRuleConfiguration();
  if(JSON.stringify(before)!==JSON.stringify(p.beforeRules))return {status:'failed',code:'PCB_RULES_CHANGED_BEFORE_WRITE'};
  // Installed client saves a global preset when overwriting a system template.
  // Never take that branch: only a confirmed existing custom task profile is writable.
  if(typeof eda.pcb_Drc.getAllRuleConfigurations!=='function')return {status:'unsupported',code:'PCB_RULE_PROFILE_SCOPE_UNVERIFIED',before};
  const customProfiles=await eda.pcb_Drc.getAllRuleConfigurations(false);
  const names=Array.isArray(customProfiles)?customProfiles.map(x=>x?.name??x?.configName??x?.ruleTemplateName??x?.configurationName):null;
  if(!names||names.some(x=>typeof x!=='string'))return {status:'unsupported',code:'PCB_RULE_PROFILE_SCOPE_UNVERIFIED',before,customProfiles};
  if(!names.includes(before.name))return {status:'needs_ui',code:'PCB_SYSTEM_RULE_TEMPLATE_REQUIRES_UI_COPY',before,customProfileNames:names,mutationRequested:false,nextAction:'In this exact task PCB, copy the system rules to a distinct task profile without replacing any preset or setting a global default, then call configuration again. Do not bypass an existing unresolved action.'};
  if(p.operation==='rules_preflight')return {status:await matches()?'ok':'unknown',before,customProfileNames:names,mutationRequested:false};
  const nativeResult=await eda.pcb_Drc.overwriteCurrentRuleConfiguration(p.afterRules.config),after=await eda.pcb_Drc.getCurrentRuleConfiguration();return {status:nativeResult===true&&await matches()?'ok':'unknown',nativeResult:nativeResult??null,before,after};
 }
 if(p.operation==='critical'){
  const log=[];for(let i=0;i<p.points.length-1;i++){if(!await matches())return {status:'unknown',code:'PCB_CRITICAL_TARGET_CHANGED',log};const x=await eda.pcb_PrimitiveLine.create(p.net,p.layer,...p.points[i],...p.points[i+1],p.width,true);if(!x)return {status:'unknown',code:'PCB_CRITICAL_CREATE_UNCONFIRMED',log};log.push(serialize(x,'Line'));}return {status:await matches()?'ok':'unknown',log};
 }
 if(p.operation==='route'){
  if(typeof eda.pcb_Document.autoRouting!=='function')return {status:'unsupported',code:'PCB_NATIVE_ROUTING_API_MISSING'};
  const startedAt=new Date().toISOString();
  try{const nativeResult=await eda.pcb_Document.autoRouting(p.props);return {status:await matches()?'ok':'unknown',nativeResult,startedAt,finishedAt:new Date().toISOString(),sourceApi:'eda.pcb_Document.autoRouting',props:p.props};}
  catch(e){return {status:'unknown',code:'PCB_NATIVE_ROUTING_ERROR',message:String(e?.message??e),startedAt};}
 }
 if(p.operation==='auto_layout'){
  const current=await eda.pcb_PrimitiveComponent.getAll();
  if(current.length!==p.beforeComponents.length||p.beforeComponents.some(c=>!current.some(n=>n.getState_PrimitiveId()===c.id&&n.getState_UniqueId()===c.uniqueId&&n.getState_X()===c.x&&n.getState_Y()===c.y&&n.getState_Rotation()===c.rotation&&n.getState_PrimitiveLock()===c.primitiveLock)))return {status:'failed',code:'AUTO_LAYOUT_SCOPE_CHANGED'};
  if(typeof eda.pcb_Document.autoLayout!=='function')return {status:'unsupported',code:'AUTO_LAYOUT_API_UNAVAILABLE',mutationRequested:false};
  const startedAt=new Date().toISOString(),nativeResult=await eda.pcb_Document.autoLayout();
  return {status:await matches()?'ok':'unknown',nativeResult,startedAt,finishedAt:new Date().toISOString(),sourceApi:'eda.pcb_Document.autoLayout',allowedComponentIds:p.beforeComponents.map(c=>c.id)};
 }
 if(p.operation==='layout'){
  const log=[];
  if(await eda.pcb_Layer.getTheNumberOfCopperLayers()!==p.plan.board.layers)await eda.pcb_Layer.setTheNumberOfCopperLayers(p.plan.board.layers);
  const b=p.plan.board,points=[[b.x,b.y],[b.x+b.width,b.y],[b.x+b.width,b.y-b.height],[b.x,b.y-b.height],[b.x,b.y]];
  if(!p.preserveOutline){const polygon=eda.pcb_MathPolygon.createPolygon(['R',b.x,b.y,b.width,b.height,0,0]);if(!polygon)return {status:'failed',code:'LAYOUT_OUTLINE_POLYGON_INVALID',log};const outline=await eda.pcb_PrimitivePolyline.create('',11,polygon,b.outlineWidth,true);if(!outline)return {status:'unknown',code:'LAYOUT_OUTLINE_CREATE_UNCONFIRMED',log};log.push({operation:'outline',object:serialize(outline,'Polyline')});}
  for(const c of p.plan.poses){if(!await matches())return {status:'unknown',code:'LAYOUT_TARGET_CHANGED',log};const moved=await eda.pcb_PrimitiveComponent.modify(c.id,{x:c.x,y:c.y,rotation:c.rotation,layer:c.layer,primitiveLock:c.fixed});if(!moved)return {status:'unknown',code:'LAYOUT_MOVE_UNCONFIRMED',log};log.push({operation:'move',id:c.id,uniqueId:c.uniqueId,x:moved.getState_X(),y:moved.getState_Y(),rotation:moved.getState_Rotation(),layer:moved.getState_Layer(),primitiveLock:moved.getState_PrimitiveLock()});}
  return {status:await matches()?'ok':'unknown',log};
 }
 if(p.operation==='check'){
  const beforeRules=await eda.pcb_Drc.getCurrentRuleConfiguration();
  const startedAt=new Date().toISOString(),errors=await eda.pcb_Drc.check(true,false,true),finishedAt=new Date().toISOString(),afterRules=await eda.pcb_Drc.getCurrentRuleConfiguration();
  return {status:Array.isArray(errors)&&await matches()?'ok':'unknown',errors,startedAt,finishedAt,beforeRules,afterRules,strict:true,includeVerboseError:true,userInterface:false,sourceApi:'eda.pcb_Drc.check(true,false,true)'};
 }
 if(p.operation==='read'){
  const objects=[];for(const kind of ['Line','Arc','Via','Polyline','Pour','Poured','Fill','Region']){const api=eda['pcb_Primitive'+kind];if(typeof api?.getAll!=='function')return {status:'unknown',code:'P3_READ_API_MISSING',kind};for(const x of await api.getAll())objects.push(serialize(x,kind));}
  const ruleConfiguration=await eda.pcb_Drc.getCurrentRuleConfiguration(),layers=await eda.pcb_Layer.getTheNumberOfCopperLayers();
  const ruleProfiles=typeof eda.pcb_Drc.getAllRuleConfigurations==='function'?await eda.pcb_Drc.getAllRuleConfigurations(false):null;
  const defaultRuleProfile=typeof eda.pcb_Drc.getDefaultRuleConfigurationName==='function'?(await eda.pcb_Drc.getDefaultRuleConfigurationName()??null):null;
  const componentsForViaOwnership=[];let footprintViaData;
  // Read models even with no live vias: a missing complete set must fail closed.
  {
   for(const c of await eda.pcb_PrimitiveComponent.getAll())componentsForViaOwnership.push({id:c.getState_PrimitiveId(),uniqueId:c.getState_UniqueId(),footprint:c.getState_Footprint(),x:c.getState_X(),y:c.getState_Y(),rotation:c.getState_Rotation(),layer:c.getState_Layer()});
   const file=await eda.sys_FileManager.getDocumentFile('models');if(!file||file.size>2*1024*1024)return {status:'unknown',code:'FOOTPRINT_VIA_MODELS_UNAVAILABLE'};let bytes='';for(const b of new Uint8Array(await file.arrayBuffer()))bytes+=String.fromCharCode(b);footprintViaData={components:componentsForViaOwnership,modelsBase64:btoa(bytes)};
  }
  return {status:await matches()?'ok':'unknown',objects,ruleConfiguration,layers,ruleProfiles,defaultRuleProfile,footprintViaData,apiAvailability:{autoRouting:typeof eda.pcb_Document.autoRouting,componentModify:typeof eda.pcb_PrimitiveComponent.modify,drcCheck:typeof eda.pcb_Drc.check,rulesOverwrite:typeof eda.pcb_Drc.overwriteCurrentRuleConfiguration},coordinates:'mil; native data coordinates',observedAt:new Date().toISOString()};
 }
 return {status:'unsupported',code:'P3_OPERATION_UNSUPPORTED'};
}
export const routingScript=p=>'('+nativeRouting.toString()+')('+JSON.stringify(p)+')';
const beforeNativeRules=old=>old.beforeNative.ruleConfiguration;
const readDoc=(a,p)=>a.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
const rawRead=async(a,p)=>{const focus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));if(focus.status!=='ok')return focus;return proveFootprintVias(await a.invokeLossless(p.sessionId,routingScript({...p,operation:'read'})));};
export const readOwnedRouting=rawRead;
export const p3Workflow={
 async jlc_eda_read_pcb_routing(p){await pcbBound(this,p);const native=await rawRead(this,p);return {...native,routingCapability:await this.routingCapability()};},
 async jlc_eda_layout_pcb(p){
  if((await load(p.workDirectory)).pcbRepairBaseline)return {status:'unknown',code:'PCB_KNOWN_PARTIAL_LAYOUT_IMMUTABLE',nativeMutationReplayed:false};
  const {dir,r}=await pcbBound(this,p);r.pcbActions??={};const key='layout/'+p.requestId,hash=fingerprint(p.layout),old=r.pcbActions[key];
  if(p.strategy!=='manual'||old?.strategy)return controlledLayout(this,p,{dir,r});
  if(old&&old.hash!==hash)return {status:'failed',code:'REQUEST_CONFLICT'};
  if(old&&p.phase==='retry_rejected'){
   if(old.retryCount||old.state!=='unknown'||old.nativeResult||old.error?.code!=='EXECUTION_ERROR')return {status:'unknown',code:'LAYOUT_RETRY_REJECTION_NOT_PROVEN'};
   const doc=await readDoc(this,p),native=await rawRead(this,p);
   if(doc.status!=='ok'||fingerprint(pcbSnapshot(doc))!==fingerprint(old.before)||compareRoutingCheckpoint(old.beforeNative,native).status!=='matched')return {status:'unknown',code:'LAYOUT_RETRY_ZERO_EFFECT_NOT_PROVEN',document:doc,native};
   old.attempts=[{error:old.error,before:old.before,beforeNative:old.beforeNative,lastReadback:old.result??null,recoveryProof:{document:doc,native},reason:'returned synchronous rejection, complete exact zero-effect snapshot; explicit single retry using documented non-copper Polyline API'}];old.retryCount=1;old.state='pending';await persist(dir,r);
   try{old.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'layout',plan:old.plan}));old.state='unknown';await persist(dir,r);return this.jlc_eda_layout_pcb({...p,phase:'verify'});}catch(e){old.state='unknown';old.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
  }
  if(old){const doc=await readDoc(this,p),native=await rawRead(this,p),comparison=verifyLayoutSnapshot(old.plan,doc,native,old.afterNative?.objects.filter(x=>x.layer===11)),outline=comparison.board?.outline;
   const footprintVias=Array.isArray(old.beforeNative?.objects)&&Array.isArray(old.before?.components)?compareMovedFootprintVias(old.beforeNative.objects,old.before.components,old.plan,native.objects??[]):{status:'mismatch',issues:[{code:'LAYOUT_BEFORE_CHECKPOINT_MISSING'}]};comparison.issues.push(...footprintVias.issues);if(footprintVias.status!=='matched')comparison.status='mismatch';
   const afterArchives=old.beforeArchives?await capturePlacementArchives(this,p):null;
   const fullPreservation=afterArchives?comparePlacementArchives(old.beforeArchives,afterArchives,{documentUuid:p.pcbDocumentUuid,beforeDocument:old.beforeDocument,afterDocument:doc,outlineId:old.nativeResult?.log?.find(x=>x.operation==='outline')?.object?.primitiveId}):null;
   const result={status:comparison.status==='matched'&&(!fullPreservation||fullPreservation.status==='matched')?'ok':'unknown',comparison,footprintVias,fullPreservation,document:doc,native,nativeMutationReplayed:false};
   if(result.status==='ok'){old.state='completed';old.after=pcbSnapshot(doc);old.afterNative=native;old.result=result;r.pcbLayoutBaseline={after:old.after,plan:old.plan,outline};await persist(dir,r);}return result;}

  if(p.phase==='verify')return {status:'failed',code:'LAYOUT_NO_RECORDED_ACTION'};
  if(unresolvedActions(r).length>0)return {status:'unknown',code:'PCB_ACTION_UNRESOLVED'};
  const doc=await readDoc(this,p),plan=planLayout(p.layout,doc),beforeNative=await rawRead(this,p);
  if(plan.status!=='ok')return plan;
  if(p.phase==='plan')return {status:'ok',plan,before:doc,beforeNative,mutationRequested:false};
  if(!r.pcbSyncBaseline||beforeNative.status!=='ok'||beforeNative.objects.some(x=>!isOwnedFootprintVia(x)))return {status:'unsupported',code:'LAYOUT_REQUIRES_SYNCHRONIZED_UNROUTED_EMPTY_ARTWORK',native:beforeNative};
  const beforeArchives=await capturePlacementArchives(this,p);
  const action={hash,state:'pending',plan,before:pcbSnapshot(doc),beforeDocument:doc,beforeArchives,beforeNative,startedAt:new Date().toISOString()};r.pcbActions[key]=action;await persist(dir,r);
  try{action.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'layout',plan}));action.state='unknown';await persist(dir,r);return this.jlc_eda_layout_pcb({...p,phase:'verify'});}catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
 },
 async jlc_eda_configure_pcb_rules(p){
  if((await load(p.workDirectory)).pcbRepairBaseline)return {status:'unknown',code:'PCB_KNOWN_PARTIAL_RULES_IMMUTABLE',nativeMutationReplayed:false};
  const {dir,r}=await pcbBound(this,p);r.pcbActions??={};const key='rules/'+p.requestId,hash=fingerprint(p.rules),old=r.pcbActions[key];
  if(old&&old.hash!==hash)return {status:'failed',code:'REQUEST_CONFLICT'};
  if(p.phase==='cleanup')return this.cleanupTaskRules(p,{dir,r,key,old});
  if(!r.pcbLayoutBaseline?.plan)return {status:'failed',code:'PCB_RULE_LAYOUT_REQUIRED',mutationRequested:false};
  if(['auto_recover','verify_auto'].includes(p.phase)||old?.autoRecovery||!old&&p.phase==='apply')return this.autoConfigureRules(p,{dir,r,key,old,hash});
  if(p.phase==='prepare_ui'){
   if(!old||old.state!=='unknown'||old.error||!p.uiProfileName||old.nativeResult?.status!=='ok'||old.nativeResult.nativeResult!==undefined||!old.nativeResult.before||!old.nativeResult.after||fingerprint(old.nativeResult.before)!==fingerprint(old.plan.before)||fingerprint(old.nativeResult.after)!==fingerprint(old.plan.before))return {status:'unknown',code:'PCB_RULE_UI_NO_EFFECT_NOT_PROVEN'};
   if(old.uiRecovery)return {status:'needs_ui',code:'PCB_RULE_UI_RECOVERY_ALREADY_PREPARED',nativeMutationReplayed:false,uiRecovery:old.uiRecovery};
   const native=await rawRead(this,p),doc=await readDoc(this,p);
   if(native.status!=='ok'||!Array.isArray(native.ruleProfiles)||doc.status!=='ok'||fingerprint(native.ruleConfiguration)!==fingerprint(old.plan.before)||verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline).status!=='matched')return {status:'unknown',code:'PCB_RULE_UI_BASELINE_CHANGED',native,document:doc};
   old.uiRecovery={profileName:p.uiProfileName,expectedConfig:old.plan.after.config,beforeNative:native,beforeDocument:pcbSnapshot(doc),preparedAt:new Date().toISOString(),source:'explicit official Design Rules import/apply; no native setter replay'};await persist(dir,r);
   return {status:'needs_ui',code:'PCB_RULE_UI_IMPORT_REQUIRED',nativeMutationReplayed:false,mutationRequested:false,profileName:p.uiProfileName,ruleConfiguration:old.plan.after.config,target:{path:r.path,sessionId:p.sessionId,pcbDocumentUuid:p.pcbDocumentUuid},nextAction:'Import this exact Rule JSON in the existing task Design Rules dialog. Apply to the task PCB, without saving/replacing a global preset or changing defaults. Verify this same request with phase=verify_ui.'};
  }
  if(p.phase==='verify_ui'){
   if(!old?.uiRecovery)return {status:'failed',code:'PCB_RULE_UI_NO_PREPARATION'};
   if(p.uiProfileName&&p.uiProfileName!==old.uiRecovery.profileName)return {status:'failed',code:'REQUEST_CONFLICT'};
   const u=old.uiRecovery,native=await rawRead(this,p),doc=await readDoc(this,p),issues=[];
   if(native.status!=='ok'||doc.status!=='ok'||!Array.isArray(doc.components)){const result={status:'unknown',code:'PCB_RULE_UI_READBACK_INCOMPLETE',native,document:doc,nativeMutationReplayed:false};old.lastReadback=result;await persist(dir,r);return result;}
   if(native.ruleConfiguration?.name!==u.profileName||fingerprint(native.ruleConfiguration?.config??null)!==fingerprint(u.expectedConfig))issues.push({code:'PCB_RULE_UI_CONFIG_MISMATCH'});
   if(fingerprint(native.ruleProfiles)!==fingerprint(u.beforeNative.ruleProfiles)||native.defaultRuleProfile!==u.beforeNative.defaultRuleProfile)issues.push({code:'PCB_RULE_UI_GLOBAL_PROFILES_CHANGED'});
   if(fingerprint(pcbSnapshot(doc))!==fingerprint(u.beforeDocument)||fingerprint(native.objects)!==fingerprint(u.beforeNative.objects)||native.layers!==u.beforeNative.layers)issues.push({code:'PCB_RULE_UI_BOARD_CHANGED'});
   const result={status:issues.length?'unknown':'ok',matched:issues.length===0,issues,native,document:doc,nativeMutationReplayed:false,uiRecovery:u};old.lastReadback=result;
   if(!issues.length){old.state='completed';old.uiResult={native,document:pcbSnapshot(doc),verifiedAt:new Date().toISOString()};r.pcbRuleBaseline=native.ruleConfiguration;}
   await persist(dir,r);return result;
  }
  if(old?.uiRecovery&&(p.phase==='apply'||p.phase==='verify'))return this.jlc_eda_configure_pcb_rules({...p,phase:'verify_ui'});
  if(old){const native=await rawRead(this,p),matched=native.status==='ok'&&fingerprint(native.ruleConfiguration??null)===fingerprint(old.plan.after);if(matched){old.state='completed';r.pcbRuleBaseline=old.plan.after;await persist(dir,r);}return {status:matched?'ok':'unknown',matched,nativeMutationReplayed:false,native,plan:old.plan};}
  if(p.phase==='verify')return {status:'failed',code:'PCB_RULE_NO_RECORDED_ACTION'};
  if(unresolvedActions(r).length>0)return {status:'unknown',code:'PCB_ACTION_UNRESOLVED'};
  const native=await rawRead(this,p),plan=configureRules(native.ruleConfiguration,p.rules);if(plan.status!=='ok')return plan;
  const preflight=await this.invoke(p.sessionId,routingScript({...p,operation:'rules_preflight',beforeRules:plan.before}));if(preflight.status!=='ok')return {...preflight,plan,nativeMutationReplayed:false};
  const action={hash,state:'pending',plan};r.pcbActions[key]=action;await persist(dir,r);
  try{action.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'rules',beforeRules:plan.before,afterRules:plan.after}));action.state='unknown';await persist(dir,r);return this.jlc_eda_configure_pcb_rules(p);}catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
 },
 async jlc_eda_route_pcb(p){
  if((await load(p.workDirectory)).pcbRepairBaseline)return {status:'unknown',code:'PCB_KNOWN_PARTIAL_USE_LOCAL_REPAIR',nativeMutationReplayed:false};
  const key='route/'+p.requestId,hash=fingerprint({critical:p.critical??null,routing:p.routing??null,unit:p.unit});let context;
  try{context=await pcbBound(this,p);}catch(e){
   // Binding reads can fail before copper reads. Invalidate only the exact
   // recorded live request, never a different target or a proved closed stage.
   let durable;try{const dir=await realpath(p.workDirectory),r=await load(dir),a=r.pcbActions?.[key];if(r.kind==='task_work_project'&&r.sessionId===p.sessionId&&r.projectUuid===p.expectedProjectUuid&&r.schematicPageUuid===p.schematicPageUuid&&r.schematicUuid===p.schematicUuid&&r.pcbDocumentUuid===p.pcbDocumentUuid&&a?.hash===hash&&['completed','invalidated'].includes(a.state))durable={dir,r,a};}catch{}
   if(durable){const result=invalidateRouteObservation(durable.a,{status:'unknown',code:'PCB_ROUTE_BINDING_READBACK_FAILED',error:{code:e.code??null,message:e.message},nativeMutationReplayed:false});await persist(durable.dir,durable.r);return result;}throw e;
  }
  const {dir,r}=context;r.pcbActions??={};const old=r.pcbActions[key];
  if(old&&old.hash!==hash)return {status:'failed',code:'REQUEST_CONFLICT'};
  if(p.phase==='prepare_restore_undo'){
   if(!old||old.phase!=='prepare_ui'||old.state!=='unknown'||old.invalidation||old.afterNative||old.uiRestore||old.nativeResult?.code!=='PCB_NATIVE_ROUTING_UI_REQUIRED'||old.lastReadback?.code!=='PCB_ROUTING_NOT_APPLIED_OR_OUTCOME_UNKNOWN')return {status:'unknown',code:'PCB_ROUTE_UNDO_RECOVERY_NOT_ELIGIBLE'};
   const native=await rawRead(this,p),doc=await readDoc(this,p);
   if(native.status!=='ok'||doc.status!=='ok'||fingerprint(pcbSnapshot(doc))!==fingerprint(old.before)||compareRoutingCheckpoint(old.beforeNative,native).status!=='matched')return {status:'unknown',code:'PCB_ROUTE_UNDO_RECOVERY_ZERO_EFFECT_NOT_PROVEN'};
   old.uiRestore={state:'prepared_once',originalReadback:old.lastReadback,beforeNative:native,beforeDocument:pcbSnapshot(doc),at:new Date().toISOString(),method:'Native Edit > Redo of the existing applied auto routing group; no engine rerun. Caller must verify the native history action.'};await persist(dir,r);
   return {status:'needs_ui',code:'PCB_ROUTE_EXISTING_UNDO_RESTORE_REQUIRED',nativeEngineInvoked:false,mutationRequested:false,target:{path:r.path,sessionId:p.sessionId},nextAction:'In the exact task, restore the existing Auto Routing redo once, then verify this original request. Do not start a new engine.'};
  }
  if(old&&p.phase==='retry_rejected'){
   if(old.retryCount||old.phase!=='native'||old.state!=='unknown'||old.nativeResult||old.error?.code!=='INVALID_ARGS'||old.error.message!=='--timeout must be an integer in [1, 60000] ms'||old.routing?.waitMs<=60000)return {status:'unknown',code:'PCB_ROUTE_RETRY_REJECTION_NOT_PROVEN'};
   const capability=await this.routingCapability();if(capability.status!=='supported')return {...capability,nativeEngineInvoked:false,nativeMutationReplayed:false,originalActionPreserved:true};
   const native=await rawRead(this,p),doc=await readDoc(this,p);
   if(doc.status!=='ok'||fingerprint(pcbSnapshot(doc))!==fingerprint(old.before)||compareRoutingCheckpoint(old.beforeNative,native).status!=='matched'||verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline).status!=='matched')return {status:'unknown',code:'PCB_ROUTE_RETRY_ZERO_EFFECT_NOT_PROVEN',native,document:doc};
   old.attempts=[{error:old.error,requestedWaitMs:old.routing.waitMs,nativeEngineInvoked:false,reason:'official CLI rejected timeout argument before dispatch',proof:{native,document:doc}}];old.retryCount=1;old.state='pending';old.nativeWaitMs=old.routing.waitMs;await persist(dir,r);
   try{old.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'route',props:{RoutingNets:old.routing.nets,ignoreNets:old.routing.ignoreNets,layers:old.routing.layers,existingPrimitiveMode:'keep',cornerStyle:old.routing.cornerStyle,optimization:old.routing.optimization}}),old.routing.waitMs);old.state='unknown';await persist(dir,r);return this.jlc_eda_route_pcb({...p,phase:'verify'});}catch(e){old.state='unknown';old.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
  }
  if(old){let native,doc;try{native=await rawRead(this,p);doc=await readDoc(this,p);}catch(e){const result=invalidateRouteObservation(old,{status:'unknown',code:'PCB_ROUTE_READBACK_FAILED',error:{code:e.code??null,message:e.message},nativeMutationReplayed:false});await persist(dir,r);return result;}const before=old.beforeNative.objects,after=native.objects;if(native.status!=='ok'||!Array.isArray(after)||doc.status!=='ok'){const result=invalidateRouteObservation(old,{status:'unknown',code:'PCB_ROUTE_READBACK_INCOMPLETE',native,document:doc,nativeMutationReplayed:false});await persist(dir,r);return result;}const preserved=before.map(x=>({id:x.primitiveId,unchanged:after.some(y=>fingerprint(x)===fingerprint(y))}));
   const added=after.filter(x=>!before.some(y=>y.primitiveId===x.primitiveId));const scope=old.routing?.nets??[old.critical?.net],nonTargetChanges=added.filter(x=>!x.net||!scope.includes(x.net)||!(x.kind==='Via'||[1,2].includes(x.layer)));const positions=positionDiff(old.before,pcbSnapshot(doc));
   const addedComparison=verifyAddedCopper(old,added,p.unit),layout=verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline);
   const actualCritical=old.critical?after.filter(x=>old.nativeResult?.log?.some(y=>y.primitiveId===x.primitiveId)):null;
   const acceptedCheckpoint=old.afterNative?compareRoutingCheckpoint(old.afterNative,native):null;
   const afterArchives=old.beforeArchives?await capturePlacementArchives(this,p):null;
   const fullPreservation=afterArchives?compareRouteArchives(old.beforeArchives,afterArchives,{documentUuid:p.pcbDocumentUuid,added}):null;
   const result={status:native.status==='ok'&&doc.status==='ok'?'ok':'unknown',native,document:doc,preserved,added,nonTargetChanges,positionChanges:positions,fullPreservation,recordedNativeResult:old.nativeResult??null,nativeMutationReplayed:false,critical:actualCritical,addedComparison,layout,acceptedCheckpoint,parameterCoverage:guiParameterCoverage(old)};
   if(acceptedCheckpoint?.status!=='matched'&&acceptedCheckpoint){result.status='unknown';result.code='PCB_ROUTE_ACCEPTED_OBSERVATION_CHANGED';}
   if(preserved.some(x=>!x.unchanged)||nonTargetChanges.length||positions.length||!ruleCheckpointEqual(beforeNativeRules(old),native.ruleConfiguration)||layout.status!=='matched'||addedComparison.status!=='matched'){result.status='unknown';result.code='PCB_ROUTE_PRESERVATION_OR_SCOPE_MISMATCH';}
   if(fullPreservation&&fullPreservation.status!=='matched'){result.status='unknown';result.code='PCB_ROUTE_FULL_ARCHIVE_UNVERIFIED';}
   const applied=old.critical?actualCritical?.length===old.points.length-1&&old.nativeResult?.status==='ok':old.phase==='prepare_ui'?added.some(x=>x.net&&[1,2].includes(x.layer)):old.nativeResult?.status==='ok'&&added.some(x=>x.net&&[1,2].includes(x.layer));
   if(!applied){result.status='unknown';result.code='PCB_ROUTING_NOT_APPLIED_OR_OUTCOME_UNKNOWN';result.nextAction='Inspect the existing native operation and exact target. Do not rerun routing. Read/verify after applying an existing native iteration.';}
   if(old.invalidation&&result.status==='ok'){result.status='unknown';result.code='PCB_ROUTE_PREVIOUSLY_INVALIDATED';}
   if(result.status==='ok'){if(old.state!=='completed'){old.state='completed';old.afterNative=native;old.after=pcbSnapshot(doc);old.afterArchives=afterArchives;old.result=result;r.pcbCopperBaseline={after:old.after,native,archives:afterArchives};}await persist(dir,r);}else{invalidateRouteObservation(old,result);await persist(dir,r);}return result;
  }
  if(p.phase==='verify')return {status:'failed',code:'PCB_ROUTE_NO_RECORDED_ACTION'};
  if(p.phase==='native'){const capability=await this.routingCapability();if(capability.status!=='supported')return {...capability,nativeMutationReplayed:false,nativeEngineInvoked:false,nextAction:'Use a verified official native UI path only after prior operations have ended. SDK declaration alone is insufficient.'};}
  if(unresolvedActions(r).length>0)return {status:'unknown',code:'PCB_ACTION_UNRESOLVED'};
  if(r.pcbLayoutCandidate&&!r.pcbLayoutCandidate.adopted)return {status:'unknown',code:'PCB_LAYOUT_CANDIDATE_NOT_ADOPTED'};
  if(!r.pcbLayoutBaseline||!r.pcbRuleBaseline)return {status:'failed',code:'PCB_ROUTE_LAYOUT_AND_RULES_REQUIRED'};
  const doc=await readDoc(this,p),beforeNative=await rawRead(this,p);if(verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,beforeNative,r.pcbLayoutBaseline.outline).status!=='matched'||!ruleCheckpointEqual(beforeNative.ruleConfiguration,r.pcbRuleBaseline))return {status:'unknown',code:'PCB_ROUTE_BASELINE_CHANGED'};
  let points;
  if(p.phase==='critical'){
   if(!p.critical)return {status:'needs_input',code:'PCB_CRITICAL_INPUT_REQUIRED'};
   const endpoint=e=>{const c=doc.components.filter(x=>x.uniqueId===e.uniqueId);return c.length===1?c[0].pins.filter(x=>x.number===e.pin):[];},from=endpoint(p.critical.from),to=endpoint(p.critical.to);
   if(from.length!==1||to.length!==1||from[0].net!==p.critical.net||to[0].net!==p.critical.net||![p.critical.layer,12].includes(from[0].layer)||![p.critical.layer,12].includes(to[0].layer))return {status:'failed',code:'PCB_CRITICAL_ENDPOINT_UNVERIFIED'};
   points=[[from[0].x,from[0].y],...p.critical.waypoints.map(q=>q.map(v=>toMil(v,p.unit))),[to[0].x,to[0].y]];
   const b=r.pcbLayoutBaseline.plan.board;if(points.some(([x,y])=>x<b.x||x>b.x+b.width||y>b.y||y<b.y-b.height))return {status:'failed',code:'PCB_CRITICAL_PATH_OUTSIDE_BOARD'};
  }else if(!p.routing)return {status:'needs_input',code:'PCB_NATIVE_ROUTING_INPUT_REQUIRED'};
  const nets=new Set(doc.components.flatMap(c=>c.pins.map(x=>x.net)).filter(Boolean));if(p.routing&&(p.routing.nets.some(x=>!nets.has(x))||p.routing.nets.some(x=>p.routing.ignoreNets.includes(x))))return {status:'failed',code:'PCB_ROUTE_NET_SCOPE_INVALID'};
  if(p.phase==='prepare_ui'&&p.guiParameterPolicy!=='allow_unverified')return {status:'unsupported',code:'PCB_GUI_PARAMETER_MAPPING_UNVERIFIED',nativeEngineInvoked:false,mutationRequested:false,parameterCoverage:guiParameterCoverage({phase:'prepare_ui'}),nextAction:'GUI cornerStyle/optimization cannot be enforced. Explicit allow_unverified policy permits copper-scope verification only; hard parameter requirements are unsupported.'};
  const beforeArchives=await capturePlacementArchives(this,p);
  const action={hash,state:'pending',phase:p.phase,critical:p.critical,routing:p.routing,requestedWaitMs:p.routing?.waitMs,nativeWaitMs:p.routing?p.routing.waitMs:15000,processWaitMs:(p.routing?p.routing.waitMs:15000)+3000,points,before:pcbSnapshot(doc),beforeNative,beforeArchives,startedAt:new Date().toISOString()};r.pcbActions[key]=action;await persist(dir,r);
  if(p.phase==='prepare_ui'){action.state='unknown';action.nativeResult={status:'needs_ui',code:'PCB_NATIVE_ROUTING_UI_REQUIRED'};await persist(dir,r);return {...action.nativeResult,target:{path:r.path,sessionId:p.sessionId,pcbDocumentUuid:p.pcbDocumentUuid},routing:p.routing,nextAction:'Configure the exact native routing scope/layers/rules and keep existing copper. Run once, explicitly apply its iteration, then verify this same request. No native engine has been invoked by this preparation.'};}
  try{action.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:p.phase==='critical'?'critical':'route',points,net:p.critical?.net,layer:p.critical?.layer,width:p.critical?toMil(p.critical.width,p.unit):undefined,props:p.routing?{RoutingNets:p.routing.nets,ignoreNets:p.routing.ignoreNets,layers:p.routing.layers,existingPrimitiveMode:'keep',cornerStyle:p.routing.cornerStyle,optimization:p.routing.optimization}:undefined}),p.phase==='native'?p.routing.waitMs:15000);action.state='unknown';await persist(dir,r);return this.jlc_eda_route_pcb({...p,phase:'verify'});}catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
 },
 async verifyP3Checkpoint(p,expected,{preservationOnly=false,drcConsistencyRequired=true}={}){
  if(expected.pcbRepairBaseline)return verifyRepairCheckpoint(this,p,expected);
  if(expected.pcbFileRouteBaseline)return checkAcceptedFile(this,p,expected);

  const identity=await this.jlc_eda_verify_pcb(p);if(identity.status!=='ok'||identity.comparison?.status!=='matched')return identity;
  const native=await rawRead(this,p),doc=await readDoc(this,p),layout=verifyLayoutSnapshot(expected.pcbLayoutBaseline.plan,doc,native,expected.pcbLayoutBaseline.outline),copper=expected.pcbCopperBaseline?compareRoutingCheckpoint(expected.pcbCopperBaseline.native,native):null;
  const rulesMatched=!expected.pcbRuleBaseline||ruleCheckpointEqual(expected.pcbRuleBaseline,native.ruleConfiguration);
  const unresolved=unresolvedActions(expected),issues=[...layout.issues,...(copper?.issues??[])];if(unresolved.length&&!preservationOnly)issues.push({code:'PCB_ACTION_UNRESOLVED',actions:unresolved});if(!rulesMatched)issues.push({code:'PCB_RULE_CHECKPOINT_MISMATCH'});
  const drc=await this.invokeLossless(p.sessionId,routingScript({...p,operation:'check'}),60000);
  if(drc.status!=='ok')issues.push({code:'PCB_FRESH_DRC_UNAVAILABLE'});
  const drcComparison=expected.pcbCheck?compareNativeDrc(expected.pcbCheck.drc?.errors,drc.errors):null;
  if(drcConsistencyRequired&&drcComparison&&drcComparison.status!=='matched')issues.push(...drcComparison.issues);
  const fullArchive=await verifyRouteArchiveCheckpoint(this,p,expected);if(fullArchive?.status==='mismatch')issues.push({code:'PCB_FULL_ARCHIVE_CHECKPOINT_CHANGED'});
  return {status:'ok',comparison:{status:issues.length?'mismatch':'matched',issues,mismatches:[],identityComparison:identity.comparison},identity,native,document:doc,layout,copperCheckpoint:copper,copper:auditCopper(doc,native),fullArchive,rulesMatched,drc,drcComparison,drcConsistencyRequired,unresolvedActions:unresolved,preservationOnly,designReadbackOnly:true};
 },
 async jlc_eda_check_pcb(p){
  const recorded=await load(p.workDirectory);
  if(recorded.pcbRepairBaseline){
   if(!sameFileTarget(recorded,p))return {status:'failed',code:'WORK_TARGET_MISMATCH',boardReady:false};
   if(recorded.finish?.state==='closed')return {status:'unknown',code:'WORK_SESSION_CLOSED',boardReady:false};
   await pcbBound(this,p);const result=await verifyRepairCheckpoint(this,p,recorded);recorded.pcbCheck=result;await persist(p.workDirectory,recorded);return result;
  }
  if(recorded.pcbFileRouteBaseline){
   if(!sameFileTarget(recorded,p))return {status:'failed',code:'WORK_TARGET_MISMATCH',boardReady:false};
   if(recorded.finish?.state==='closed')return {status:'unknown',code:'WORK_SESSION_CLOSED',boardReady:false};
   try{const {r}=await pcbBound(losslessView(this),p);return await checkAcceptedFile(this,p,r);}
   catch(error){return recordFileCheckFailure(p,recorded,error);}
  }
  const {dir,r}=await pcbBound(this,p),identity=await this.jlc_eda_verify_pcb(p);if(identity.status!=='ok'||identity.comparison?.status!=='matched')return {status:'unknown',code:'PCB_CHECK_IDENTITY_UNVERIFIED',identity};
  await this.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));
  const drc=await this.invokeLossless(p.sessionId,routingScript({...p,operation:'check'}),60000),native=await rawRead(this,p),doc=await readDoc(this,p);
  const result={status:drc.status==='ok'?'ok':'unknown',identity,drc,native,document:doc,layout:r.pcbLayoutBaseline?verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline):null,drcPassed:drc.status==='ok'&&drc.errors.length===0&&ruleCheckpointEqual(drc.beforeRules,drc.afterRules)};
  result.fullArchive=await verifyRouteArchiveCheckpoint(this,p,r);
  result.copper=auditCopper(doc,native);result.rulesMatched=!!r.pcbRuleBaseline&&ruleCheckpointEqual(native.ruleConfiguration,r.pcbRuleBaseline);result.unresolvedActions=unresolvedActions(r);result.boardReady=(!result.fullArchive||result.fullArchive.status==='matched')&&(!r.pcbLayoutCandidate||r.pcbLayoutCandidate.adopted)&&result.unresolvedActions.length===0&&result.identity.comparison.status==='matched'&&result.layout?.status==='matched'&&result.drcPassed&&result.rulesMatched&&result.copper.fullyConnected;
  r.pcbCheck=result;await persist(dir,r);return result;
 }
};
export function compareRoutingCheckpoint(expected,actual,{compareRules=true}={}){
 const issues=[],before=expected.objects??[],after=actual.objects??[];
 if(actual.status!=='ok'||before.length!==after.length)issues.push({code:'PCB_COPPER_CHECKPOINT_OBJECT_COUNT'});
 for(const x of before){const found=after.filter(y=>y.primitiveId===x.primitiveId);if(found.length!==1){issues.push({code:'PCB_COPPER_CHECKPOINT_ID',id:x.primitiveId});continue;}const y=found[0];for(const k of new Set([...Object.keys(x),...Object.keys(y)])){const same=['startX','startY','endX','endY','x','y','lineWidth','diameter','holeDiameter'].includes(k)&&typeof x[k]==='number'&&typeof y[k]==='number'?Math.abs(x[k]-y[k])<=0.0001:fingerprint(x[k]??null)===fingerprint(y[k]??null);if(!same)issues.push({code:'PCB_COPPER_CHECKPOINT_VALUE',id:x.primitiveId,key:k,expected:x[k],actual:y[k]});}}
 if(expected.layers!==actual.layers)issues.push({code:'PCB_LAYER_CHECKPOINT_MISMATCH'});
 if(compareRules&&!ruleCheckpointEqual(expected.ruleConfiguration,actual.ruleConfiguration))issues.push({code:'PCB_RULE_CHECKPOINT_MISMATCH'});
 return {status:issues.length?'mismatch':'matched',issues};
}

const sameFileTarget=(r,p)=>r.kind==='task_work_project'&&r.sessionId===p.sessionId&&r.projectUuid===p.expectedProjectUuid&&r.schematicPageUuid===p.schematicPageUuid&&r.schematicUuid===p.schematicUuid&&r.pcbDocumentUuid===p.pcbDocumentUuid&&(!p.circuit||fingerprint(r.circuit)===fingerprint(p.circuit));
const wrongTargetCodes=new Set(['WORK_TARGET_MISMATCH','WORK_PCB_TARGET_MISMATCH','WORK_PATH_MISMATCH','WORK_PATH_UNCONFIRMED','WORK_RECOVERY_VERIFICATION_REQUIRED','PCB_ASSOCIATION_MISMATCH_OR_AMBIGUOUS','PCB_PROJECT_IDENTITY_UNCERTAIN','PCB_TARGET_MISMATCH','P3_TARGET_MISMATCH','PCB_NATIVE_TARGET_OR_ASSOCIATION_MISMATCH','PCB_TARGET_CHANGED_DURING_READ']);
async function storeFileCheck(p,r,result){
 if(wrongTargetCodes.has(result.code))return result;
 // Fresh disk verification may have another session/project UUID. It never
 // writes into the original live journal; closed journals are immutable here.
 if(sameFileTarget(r,p)&&r.finish?.state!=='closed'){
  const action=r.fileRouteActions?.[r.pcbFileRouteBaseline.requestId];
  if(action&&result.acceptedStoredCopperEvidence)action.acceptedStoredCopperEvidence??=result.acceptedStoredCopperEvidence;
  const contentOrReadFailure=result.comparison?.status!=='matched'&&(result.comparison?.issues??[]).some(x=>x.code!=='FILE_ACTION_UNRESOLVED');
  if(action&&contentOrReadFailure)invalidateRouteObservation(action,result);
  result.unresolvedActions=unresolvedActions(r);r.pcbCheck=result;await persist(p.workDirectory,r);
 }
 return result;
}
async function recordFileCheckFailure(p,r,error){
 const result={status:'unknown',code:'FILE_CHECK_READ_FAILED',error:{code:error.code??null,message:error.message},comparison:{status:'mismatch',issues:[{code:error.code??'FILE_CHECK_READ_FAILED'}]},checkBasis:fileCheckBasis,boardReady:false,designReady:false,drcPassed:false,rulesMatched:false,nativeMutationReplayed:false};
 if(wrongTargetCodes.has(error.code))return {...result,code:error.code};
 return storeFileCheck(p,r,result);
}
async function checkAcceptedFile(a,p,r){
 try{return await storeFileCheck(p,r,await verifyAcceptedFileRoute(a,p,r));}
 catch(error){return recordFileCheckFailure(p,r,error);}
}

async function verifyRouteArchiveCheckpoint(a,p,r){
 const expected=r.pcbCopperBaseline?.archives;if(!expected)return null;
 const actual=await capturePlacementArchives(a,p);const matched=fingerprint(expected.schematic)===fingerprint(actual.schematic)&&fingerprint(expected.pcb)===fingerprint(actual.pcb);return {status:matched?"matched":"mismatch",expected:{schematic:expected.schematic,pcb:expected.pcb},actual:{schematic:actual.schematic,pcb:actual.pcb}};
}
