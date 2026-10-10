import{parseNativeSource}from'./native-records.mjs';
import {unzipSync,strFromU8} from 'fflate';import {fingerprint} from './drawing.mjs';import {compareNativeRuleConfig,ruleCheckpointEqual} from './rules.mjs';
const projectionPath=['Physics','Differential Pair','differentialPair','form','diffPairSpacingTables','data','1','maxValue'];
export function extractNativeRules(data,documentUuid){
 const rows=[];for(const [name,bytes] of Object.entries(unzipSync(Buffer.from(data,'base64'))))if(name.endsWith('.epru')){let current;
  for(const {header:h,body,deleted}of parseNativeSource(strFromU8(bytes))){if(deleted)continue;if(h.type==='DOCHEAD')current=body.uuid;else if(current===documentUuid&&['RULE','RULE_TEMPLATE','RULE_SELECTOR'].includes(h.type))rows.push({documentUuid,type:h.type,id:h.id??null,body});}}
 if(rows.filter(x=>x.type==='RULE_TEMPLATE').length!==1||!rows.some(x=>x.type==='RULE')||rows.some(x=>!x.id)||new Set(rows.map(x=>x.type+'/'+x.id)).size!==rows.length)throw Error('NATIVE_RULE_COVERAGE');rows.sort((a,b)=>fingerprint(a).localeCompare(fingerprint(b)));
 return {documentUuid,rows,sha256:fingerprint(rows),complete:true};
}
export function compareRulesWithEvidence(expected,actual,{expectedNative,actualNative,allowProjection=false}={}){
 const strict={status:ruleCheckpointEqual(expected,actual)?'matched':'mismatch',config:compareNativeRuleConfig(expected?.config,actual?.config)};
 if(strict.status==='matched'){
  const nativeCompared=!!expectedNative||!!actualNative,nativeMatched=!nativeCompared||!!expectedNative?.complete&&!!actualNative?.complete&&fingerprint(expectedNative.rows)===expectedNative.sha256&&fingerprint(actualNative.rows)===actualNative.sha256&&expectedNative.sha256===actualNative.sha256&&expectedNative.documentUuid===actualNative.documentUuid;
  return {status:nativeMatched?'matched':'mismatch',strict,projectionException:false,nativeCompared,nativeMatched};
 }
 const issues=strict.config.issues,onlyProjection=issues.length===1&&fingerprint(issues[0].path)===fingerprint(projectionPath)&&issues[0].code==='RULE_VALUE_CHANGED'&&((issues[0].expected===0&&issues[0].actual===null)||(issues[0].expected===null&&issues[0].actual===0));
 const pairRows=expectedNative?.rows?.filter(x=>x.type==='RULE'&&x.id===JSON.stringify(['RULE','DIFFER_ENTAIL','differentialPair']))??[],spacing=pairRows[0]?.body?.ruleContext?.spacing?.content;
 const absentMax=pairRows.length===1&&Array.isArray(spacing)&&spacing.length===1&&spacing[0].layerId===1&&!Object.hasOwn(spacing[0],'spacMax');
 const sameMetadata=expected&&actual&&fingerprint(Object.fromEntries(Object.entries(expected).filter(([k])=>k!=='config')))===fingerprint(Object.fromEntries(Object.entries(actual).filter(([k])=>k!=='config')));
 const nativeMatched=!!expectedNative?.complete&&!!actualNative?.complete&&expectedNative.documentUuid===actualNative.documentUuid&&fingerprint(expectedNative.rows)===expectedNative.sha256&&fingerprint(actualNative.rows)===actualNative.sha256&&expectedNative.sha256===actualNative.sha256;
 return {status:allowProjection&&sameMetadata&&onlyProjection&&absentMax&&nativeMatched?'matched':'mismatch',strict,projectionException:!!(allowProjection&&sameMetadata&&onlyProjection&&absentMax&&nativeMatched),nativeMatched,absentNativeSpacMax:absentMax,qualification:'Only source-bound absent spacMax -> API maxValue 0/null projection; stored records compared exactly, all other differences refused.'};
}
