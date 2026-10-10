// Editor-only allocation counters. Geometry, nets, IDs and rules are checked separately.
// Only positive changes to LINE placeholder maxima may consume the exact number
// of newly created Line/Via primitives. No arbitrary record type is ignored.
export function allocatorChanges(before,after,createdCount){
 const old=before.filter(r=>r.header.type==='ELE_PLACEHOLDER'),now=after.filter(r=>r.header.type==='ELE_PLACEHOLDER'),map=new Map(now.map(r=>[r.header.id,r])),accepted=[],issues=[];let consumed=0,maxId=Math.max(0,...old.map(r=>Number(String(r.header.id).replace(/^placeholder/,''))));
 for(const r of old){const n=map.get(r.header.id);if(!n){issues.push(r.header.id);continue;}if(JSON.stringify(r.body)===JSON.stringify(n.body))continue;const a=r.body,b=n.body;if(Object.keys(a).length!==2||Object.keys(b).length!==2||a.dataType!=='LINE'||b.dataType!=='LINE'||!Number.isInteger(a.max)||!Number.isInteger(b.max)||b.max<a.max){issues.push(r.header.id);continue;}const delta=b.max-a.max;consumed+=delta;accepted.push({id:r.header.id,before:a,after:b,increment:delta});}
 const added=now.filter(r=>!old.some(x=>x.header.id===r.header.id)).sort((a,b)=>Number(String(a.header.id).replace(/^placeholder/,''))-Number(String(b.header.id).replace(/^placeholder/,'')));
 for(const r of added){const b=r.body;if(r.header.id!=='placeholder'+(++maxId)||Object.keys(b).length!==2||b.dataType!=='LINE'||!Number.isInteger(b.max)||b.max<1){issues.push(r.header.id);continue;}consumed+=b.max;accepted.push({id:r.header.id,before:null,after:b,increment:b.max});}
 if(consumed!==createdCount)issues.push('allocationBudget');return {matched:!issues.length,issues,accepted,consumed,createdPrimitiveCount:createdCount,qualification:'Only scalar non-geometric allocation metadata; exact positive budget equals newly created Line/Via objects. All actual native design objects and rules remain subject to separate full preservation.'};
}
