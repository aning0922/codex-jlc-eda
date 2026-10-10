import {z} from 'zod';
// Native PCB lengths serialize at 0.0001 mil precision. Only recognized mm
// measurements get this tolerance; names, controls, units and topology stay exact.
export function compareNativeRuleConfig(expected,actual){
 const issues=[],toleranceMm=0.0001*0.0254;let maximumNumericDeltaMm=0;
 const lengths=new Set(['minValue','defaultValue','maxValue','device2device','thru2Smd','hole2Hole','creepageDistance','netLengthMin','netLengthMax','netLengthTolerance','differentailPairLenTolerMax','maxHeight','lineClearance','lineWidth','networkSpacing','distance2Border']);
 function walk(a,b,path=[],unit=null){
  if(a===b)return;
  if(a&&b&&typeof a==='object'&&typeof b==='object'){
   if(Array.isArray(a)!==Array.isArray(b)){issues.push({path,code:'RULE_STRUCTURE_CHANGED'});return;}
   const keys=Object.keys(a);if(keys.length!==Object.keys(b).length||keys.some(k=>!Object.hasOwn(b,k))){issues.push({path,code:'RULE_KEYS_CHANGED'});return;}
   const next=Array.isArray(a)?unit:a.unit??unit;for(const key of keys)walk(a[key],b[key],[...path,key],next);return;
  }
  const key=path.at(-1),measurement=unit==='mm'&&(lengths.has(key)||/^via(?:Outer|Inner)diameter(?:Min|Max|Default)$/.test(key)||/Expansion$/.test(key)||path.includes('Safe Spacing')&&path.includes('content'));
  if(measurement&&typeof a==='number'&&typeof b==='number'&&Number.isFinite(a)&&Number.isFinite(b)){const delta=Math.abs(a-b);maximumNumericDeltaMm=Math.max(maximumNumericDeltaMm,delta);if(delta<=toleranceMm+1e-12)return;}
  issues.push({path,code:'RULE_VALUE_CHANGED',expected:a,actual:b});
 }
 walk(expected,actual);return {status:issues.length?'mismatch':'matched',issues,toleranceMm,maximumNumericDeltaMm};
}
export function ruleCheckpointEqual(expected,actual){
 if(!expected||!actual)return expected===actual;
 if(typeof expected!=='object'||typeof actual!=='object')return expected===actual;
 const keys=Object.keys(expected);return keys.length===Object.keys(actual).length&&keys.every(key=>Object.hasOwn(actual,key)&&(key==='config'?compareNativeRuleConfig(expected.config,actual.config).status==='matched':JSON.stringify(expected[key])===JSON.stringify(actual[key])));
}
// Homogeneous pairs use items:{...}, with min/maxItems=2. Codex's tool
// schema converter rejects the tuple form items:[{...},{...}]. Keep the
// wire format and exact pair-length validation unchanged.
export const rulesSchema=z.object({unit:z.literal('mm'),copperClearance:z.number().finite().positive(),boardClearance:z.number().finite().positive(),track:z.object({minimum:z.number().finite().positive(),default:z.number().finite().positive(),maximum:z.number().finite().positive()}).strict(),via:z.object({diameter:z.number().finite().positive(),hole:z.number().finite().positive()}).strict(),clearanceOverrides:z.array(z.object({objects:z.array(z.string().min(1)).length(2),minimum:z.number().finite().positive()}).strict()).max(100).default([]),manufacturingReference:z.string().min(1).max(2000)}).strict().refine(p=>p.track.minimum<=p.track.default&&p.track.default<=p.track.maximum&&p.via.diameter>p.via.hole,'Invalid physical rule range');
export function configureRules(before,input){
 const p=rulesSchema.parse(input),after=structuredClone(before),issues=[];
 const spacing=after?.config?.Spacing?.['Safe Spacing']?.copperThickness1oz,track=after?.config?.Physics?.Track?.copperThickness1oz,via=after?.config?.Physics?.['Via Size']?.viaSize;
 if(spacing?.unit!=='mm'||!spacing.isSetDefault||track?.unit!=='mm'||!track.isSetDefault||via?.unit!=='mm'||!via.isSetDefault||!spacing.tables?.['1']?.content||!track.form?.data?.['1']||!via.form)return {status:'unsupported',code:'PCB_NATIVE_RULE_SCHEMA_UNVERIFIED'};
 const copper=['Track','SMD Pad','TH Pad','SMD Test Point','TH Test Point','Via','Fill Region/Teardrop','Copper/Plane Zone'];
 const edits=[];
 for(let row=0;row<spacing.row.length;row++)for(let column=0;column<spacing.column.length;column++){
  const a=spacing.row[row],b=spacing.column[column];let desired;
  if(copper.includes(a)&&copper.includes(b))desired=p.copperClearance;
  else if((a==='Board Outline'&&copper.includes(b))||(b==='Board Outline'&&copper.includes(a)))desired=p.boardClearance;
  if(desired!==undefined&&typeof spacing.tables['1'].content[row]?.[column]==='number'){edits.push({path:['Spacing','Safe Spacing','copperThickness1oz','tables','1','content',row,column],before:spacing.tables['1'].content[row][column],after:desired});spacing.tables['1'].content[row][column]=desired;}
 }
 for(const override of p.clearanceOverrides){
  const [a,b]=override.objects,candidates=[[spacing.row.indexOf(a),spacing.column.indexOf(b)],[spacing.row.indexOf(b),spacing.column.indexOf(a)]],valid=candidates.filter(([row,col])=>row>=0&&col>=0&&typeof spacing.tables['1'].content[row]?.[col]==='number');
  if(!valid.length){issues.push({code:'PCB_RULE_CLEARANCE_PAIR_UNSUPPORTED',objects:override.objects});continue;}
  for(const [row,column] of valid){edits.push({path:['Spacing','Safe Spacing','copperThickness1oz','tables','1','content',row,column],before:spacing.tables['1'].content[row][column],after:override.minimum});spacing.tables['1'].content[row][column]=override.minimum;}
 }
 const data=track.form.data['1'];for(const [key,v] of Object.entries({minValue:p.track.minimum,defaultValue:p.track.default,maxValue:p.track.maximum})){edits.push({path:['Physics','Track','copperThickness1oz','form','data','1',key],before:data[key],after:v});data[key]=v;}
 for(const [key,v] of Object.entries({viaOuterdiameterDefault:p.via.diameter,viaInnerdiameterDefault:p.via.hole})){edits.push({path:['Physics','Via Size','viaSize','form',key],before:via.form[key],after:v});via.form[key]=v;}
 if(p.via.diameter<via.form.viaOuterdiameterMin||p.via.diameter>via.form.viaOuterdiameterMax||p.via.hole<via.form.viaInnerdiameterMin-1e-6||p.via.hole>via.form.viaInnerdiameterMax)issues.push({code:'PCB_VIA_OUTSIDE_NATIVE_MIN_MAX'});
 return {status:issues.length?'failed':'ok',issues,before,after,input:p,edits,checksDisabled:false,scope:'only current task PCB rule configuration; global defaults and presets unchanged'};
}
