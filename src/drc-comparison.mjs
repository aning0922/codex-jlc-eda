import {fingerprint} from './drawing.mjs';
// DRC root and group `list` arrays are display collections. Every other array
// (object pairs, layer ids, coordinate/path vectors) remains ordered.
function canonical(value,collection=false,group=false){
 if(Array.isArray(value)){const items=value.map(v=>canonical(v,false,collection));return collection?items.sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))):items;}
 if(value&&typeof value==='object'){
  const displayGroup=group&&typeof value.name==='string'&&Array.isArray(value.list)&&!('errorType' in value)&&!('explanation' in value);
  return Object.fromEntries(Object.keys(value).filter(k=>k!=='globalIndex').sort().map(k=>[k,canonical(value[k],displayGroup&&k==='list')]));
 }
 return value;
}
export function compareNativeDrc(expected,actual){
 if(!Array.isArray(expected)||!Array.isArray(actual))return {status:'unknown',issues:[{code:'PCB_DRC_COMPARISON_INCOMPLETE'}]};
 const expectedFingerprint=fingerprint(canonical(expected,true)),actualFingerprint=fingerprint(canonical(actual,true));
 return {status:expectedFingerprint===actualFingerprint?'matched':'mismatch',issues:expectedFingerprint===actualFingerprint?[]:[{code:'PCB_FRESH_DRC_RESULTS_DIFFER'}],expectedFingerprint,actualFingerprint,method:'all fields exact except volatile globalIndex; only root and group list order ignored; duplicate multiplicity and other arrays preserved'};
}
