import {persist} from './workflow.mjs';
import {fingerprint} from './drawing.mjs';
import {configureRules,compareNativeRuleConfig} from './rules.mjs';
import {pcbSnapshot,positionDiff} from './pcb.mjs';
import {verifyLayoutSnapshot} from './pcb-validation.mjs';
import {routingScript} from './p3.mjs';
import {scripts} from './native-scripts.mjs';
const eq=(a,b)=>fingerprint(a??null)===fingerprint(b??null);
const doc=(a,p)=>a.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
async function snapshot(a,p){
 const focus=await a.invoke(p.sessionId,scripts.focus({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb'}));if(focus.status!=='ok')return {native:focus};
 return {native:await a.invoke(p.sessionId,routingScript({...p,operation:'read'})),document:await doc(a,p)};
}
function scopeIssues(u,live,expected){
 const n=live.native,d=live.document,issues=[];
 if(n?.status!=='ok'||d?.status!=='ok'||d.truncated!==false||!Array.isArray(d.components)||!Array.isArray(n.ruleProfiles)){issues.push({code:'PCB_RULE_AUTO_READBACK_INCOMPLETE'});return {issues,added:[]};}
 const rules=compareNativeRuleConfig(expected,n.ruleConfiguration?.config);if(rules.status!=='matched')issues.push({code:'PCB_RULE_AUTO_VALUES_MISMATCH',comparison:rules});
 if(!eq(u.beforeNative.objects,n.objects)||u.beforeNative.layers!==n.layers||!eq(u.beforeDocument,pcbSnapshot(d)))issues.push({code:'PCB_RULE_AUTO_BOARD_CHANGED'});
 const before=u.beforeNative.ruleProfiles,after=n.ruleProfiles;
 if(before.some(x=>after.filter(y=>y.name===x.name&&eq(y,x)).length!==1)||new Set(after.map(x=>x.name)).size!==after.length)issues.push({code:'PCB_RULE_AUTO_EXISTING_PROFILE_CHANGED'});
 if(n.defaultRuleProfile!==u.beforeNative.defaultRuleProfile)issues.push({code:'PCB_RULE_AUTO_DEFAULT_CHANGED'});
 const added=after.filter(x=>!before.some(y=>y.name===x.name));
 if(added.length>1||added.some(x=>!eq(x.config,expected)||x.name!==n.ruleConfiguration?.name))issues.push({code:'PCB_RULE_AUTO_PROFILE_SCOPE_MISMATCH'});
 if(!added.length&&n.ruleConfiguration?.name!==u.beforeNative.ruleConfiguration?.name&&n.ruleConfiguration?.name!==u.appliedProfileName)issues.push({code:'PCB_RULE_AUTO_UNOWNED_PROFILE_NAME'});
 return {issues,added,rules};
}

export const ruleRecoveryWorkflow={async autoConfigureRules(p,{dir,r,key,old,hash}){
 if(p.phase==='verify_auto'&&!old?.autoRecovery)return {status:'failed',code:'PCB_RULE_AUTO_NO_RECORDED_ACTION'};
 if(!old?.autoRecovery){
  if(Object.entries(r.pcbActions).some(([k,v])=>k!==key&&v.state!=='completed'))return {status:'unknown',code:'PCB_ACTION_UNRESOLVED'};
  const live=await snapshot(this,p),n=live.native,d=live.document;
  if(n?.status!=='ok'||!Array.isArray(n.ruleProfiles)||d?.status!=='ok'||verifyLayoutSnapshot(r.pcbLayoutBaseline?.plan,d,n,r.pcbLayoutBaseline?.outline).status!=='matched')return {status:'unknown',code:'PCB_RULE_AUTO_BASELINE_UNVERIFIED',...live};
  let plan=old?.plan??configureRules(n.ruleConfiguration,p.rules);if(plan.status&&plan.status!=='ok')return plan;
  const already=compareNativeRuleConfig(plan.after.config,n.ruleConfiguration.config).status==='matched';
  if(old&&!already){const first=old.nativeResult;if(old.state!=='unknown'||old.error||first?.status!=='ok'||first.nativeResult!==undefined||!first.before||!first.after||!eq(first.before,plan.before)||!eq(first.after,plan.before)||!eq(n.ruleConfiguration,plan.before))return {status:'unknown',code:'PCB_RULE_AUTO_OLD_EFFECT_UNCERTAIN',...live};}
  if(!old){old={hash,state:'pending',plan};r.pcbActions[key]=old;}
  old.autoRecovery={state:already?'verification_pending':'pending',beforeNative:n,beforeDocument:pcbSnapshot(d),expectedConfig:plan.after.config,previousState:old.state,originalNativeResult:old.nativeResult??null,preparedAt:new Date().toISOString(),setterInvocations:already?0:1};
  await persist(dir,r);
  if(!already){try{old.autoRecovery.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'rules_scoped',beforeRules:n.ruleConfiguration,afterRules:plan.after,beforeProfiles:n.ruleProfiles,beforeDefault:n.defaultRuleProfile}));old.autoRecovery.state='verification_pending';await persist(dir,r);}catch(e){old.autoRecovery.state='unknown';old.autoRecovery.error={code:e.code,message:e.message};await persist(dir,r);return {status:'unknown',code:e.code??'PCB_RULE_AUTO_NATIVE_UNKNOWN',message:e.message,nativeMutationReplayed:false};}}
 }
 const u=old.autoRecovery,live=await snapshot(this,p),checked=scopeIssues(u,live,u.expectedConfig);
 if(live.native?.status==='ok'&&live.document?.status==='ok'&&verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,live.document,live.native,r.pcbLayoutBaseline.outline).status!=='matched')checked.issues.push({code:'PCB_RULE_AUTO_LAYOUT_CHANGED'});
 if(u.setterInvocations&&u.nativeResult?.nativeResult===false)checked.issues.push({code:'PCB_RULE_AUTO_NATIVE_RETURNED_FALSE'});
 if(u.nativeResult?.status==='failed')checked.issues.push({code:'PCB_RULE_AUTO_NATIVE_REJECTED'});
 const result={status:checked.issues.length?'unknown':'ok',matched:checked.issues.length===0,issues:checked.issues,rulesComparison:checked.rules,...live,ownedProfiles:checked.added,nativeMutationReplayed:false,recordedAutoResult:u.nativeResult??null,originalNativeResult:old.nativeResult??null};
 u.lastReadback=result;
 if(!checked.issues.length){u.state='completed';u.ownedProfiles??=checked.added;u.appliedProfileName=live.native.ruleConfiguration.name;u.verifiedAt=new Date().toISOString();old.state='completed';r.pcbRuleBaseline=live.native.ruleConfiguration;}
 await persist(dir,r);return result;
},async cleanupTaskRules(p,{dir,r,key,old}){
 if(old?.autoRecovery?.state!=='completed'||old.state!=='completed')return {status:'unknown',code:'PCB_RULE_AUTO_NOT_VERIFIED'};
 const u=old.autoRecovery,owned=u.ownedProfiles??[];if(!owned.length)return {status:'ok',cleanupRequired:false,nativeMutationReplayed:false};
 const cleanupKey='rules_cleanup/'+p.requestId;let c=r.pcbActions[cleanupKey];
 const live=await snapshot(this,p),n=live.native;
 if(n?.status!=='ok'||live.document?.status!=='ok')return {status:'unknown',code:'PCB_RULE_CLEANUP_READ_INCOMPLETE',...live};
 if(!c){
  if(!eq(n.ruleConfiguration,r.pcbRuleBaseline)||owned.some(x=>n.ruleProfiles.filter(y=>y.name===x.name&&eq(x,y)).length!==1)||u.beforeNative.ruleProfiles.some(x=>!n.ruleProfiles.some(y=>eq(x,y)))||n.defaultRuleProfile!==u.beforeNative.defaultRuleProfile)return {status:'unknown',code:'PCB_RULE_CLEANUP_OWNERSHIP_CHANGED',...live};
  c={state:'pending',ownedProfiles:owned,beforeNative:n,beforeDocument:pcbSnapshot(live.document),startedAt:new Date().toISOString()};r.pcbActions[cleanupKey]=c;await persist(dir,r);
  try{c.nativeResult=await this.invoke(p.sessionId,routingScript({...p,operation:'rules_cleanup',beforeRules:n.ruleConfiguration,beforeProfiles:n.ruleProfiles,beforeDefault:n.defaultRuleProfile,ownedProfiles:owned}));c.state='unknown';await persist(dir,r);}catch(e){c.state='unknown';c.error={code:e.code,message:e.message};await persist(dir,r);return {status:'unknown',code:e.code??'PCB_RULE_CLEANUP_UNKNOWN'};}
 }
 const after=await snapshot(this,p),expected=c.beforeNative.ruleProfiles.filter(x=>!owned.some(y=>y.name===x.name)),issues=[];
 if(after.native?.status!=='ok'||after.document?.status!=='ok'||!eq(after.native.ruleProfiles,expected)||after.native.defaultRuleProfile!==c.beforeNative.defaultRuleProfile||!eq(after.native.ruleConfiguration,c.beforeNative.ruleConfiguration)||!eq(after.native.objects,c.beforeNative.objects)||after.native.layers!==c.beforeNative.layers||positionDiff(c.beforeDocument,pcbSnapshot(after.document)).length)issues.push({code:'PCB_RULE_CLEANUP_SCOPE_MISMATCH'});
 const result={status:issues.length?'unknown':'ok',issues,...after,nativeMutationReplayed:false,ownedProfileNames:owned.map(x=>x.name)};c.result=result;if(!issues.length){c.state='completed';u.cleanupVerified=true;}await persist(dir,r);return result;
}};
