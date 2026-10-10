import {fingerprint} from './drawing.mjs';
// Native models snapshots give deletion placeholders ordinal IDs. A newly
// deleted LINE block can shift later COMPONENT/ATTR placeholders by one index.
// Preserve every previous body in order; qualify only exact removed-record sums.
export function passiveDeletionPlaceholders(before,after,budgets,uuid){
 const old=before.filter(r=>r.header.type==='ELE_PLACEHOLDER'),now=after.filter(r=>r.header.type==='ELE_PLACEHOLDER'),issues=[],recordMappings=[],used=new Set();let cursor=0;
 for(const [i,r]of old.entries())if(r.header.id!=='placeholder'+(i+1))issues.push({code:'PASSIVE_OLD_PLACEHOLDER_ORDER_UNPROVEN',id:r.header.id});
 for(const [i,r]of now.entries())if(r.header.id!=='placeholder'+(i+1))issues.push({code:'PASSIVE_PLACEHOLDER_ORDER_CHANGED',id:r.header.id});
 for(const r of old){const i=now.findIndex((n,i)=>i>=cursor&&fingerprint(n.body)===fingerprint(r.body));if(i<0){issues.push({code:'PASSIVE_OLD_PLACEHOLDER_BODY_LOST',id:r.header.id});continue;}used.add(i);cursor=i+1;if(r.header.id!==now[i].header.id)recordMappings.push({uuid,type:'ELE_PLACEHOLDER',oldId:r.header.id,newId:now[i].header.id});}
 const added=now.filter((_,i)=>!used.has(i)),sums={};for(const r of added){const b=r.body;if(Object.keys(b).length!==2||!Object.hasOwn(budgets,b.dataType)||!Number.isInteger(b.max)||b.max<1)issues.push({code:'PASSIVE_UNDECLARED_PLACEHOLDER_BODY',id:r.header.id,body:b});else sums[b.dataType]=(sums[b.dataType]??0)+b.max;}
 for(const [kind,budget]of Object.entries(budgets))if((sums[kind]??0)!==budget)issues.push({code:'PASSIVE_DELETION_PLACEHOLDER_BUDGET_MISMATCH',kind,budget,actual:sums[kind]??0});
 return{status:issues.length?'mismatch':'matched',issues,recordMappings,newIds:added.map(r=>r.header.id),added,budgets,qualification:'Only ordinal deletion placeholder IDs may shift. All prior bodies stay exact and in order; additions equal the exact removed native target/component attribute/LINE record counts.'};
}
