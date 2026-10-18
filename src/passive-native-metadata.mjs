import {nativeModelRecords} from './file-model-evidence.mjs';
import {fingerprint} from './drawing.mjs';

// V4.1.71 bundled pro-pcb 4.1.61.12d72298: cd default net model,
// CEA reader, NET serializer and display/color serializers. See
// docs/native-preview-defaults.md for the exact source evidence and limits.
const defaults = [
 ['NET','',{netType:null,specialColor:null,retLine:true,differentialName:null,isPositiveNet:false,equalLengthGroupName:null}],
 ['PRIMITIVE','ALL',{layerId:56,display:false,color:null}],
 ['PRIMITIVE','DRC',{layerId:0,color:'#FFCC00'}],
 ['PRIMITIVE','PROHIBITEDREGION',{layerId:0,color:'#9966FF'}],
 ['PRIMITIVE','BOARDSHAPE',{layerId:0,color:'#6D6A69'}],
 ['PRIMITIVE','PARTITION',{layerId:0,color:'#C0C0C0'}],
 ['PRIMITIVE','PROPERTY',{layerId:0,display:false,color:null}],
 ...Object.entries({CURSOR:'#00ffff',BACKGROUND:'#000000',GRID:'#ffffff',BOLDGRID:'#ffffff',COORDINATEAXIS:'#ffffff',SELECTBOX:'#00ffff'}).map(([name,color])=>['PRIMITIVE',name,{display:true,color}]),
].map(([type,name,body])=>({type,id:JSON.stringify([type,name]),body}));
const equal=(a,b)=>fingerprint(a)===fingerprint(b);
const rowsFor=(d,p)=>d?.rows.filter(r=>r.type===p.type&&r.id===p.id)??[];
const spec=r=>defaults.find(p=>p.type===r.type&&p.id===r.id);
const unique=d=>d&&new Set(d.rows.map(r=>JSON.stringify([r.type,r.id]))).size===d.rows.length;
const source=d=>{const m=d?.rows.filter(r=>r.type==='META')??[];return m.length===1&&typeof m[0].body.source==='string'?m[0].body.source:null;};
const sorted=rows=>rows.map(({type,id,body})=>({type,id,body})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
const anchor=d=>fingerprint({docType:d.docType,records:sorted(d.rows.filter(r=>!spec(r))),tombstones:d.tombstones??[]});
const oldAll={layerId:0,display:true,color:null};
function legacy(p){return p.type==='PRIMITIVE'&&(p.id==='["PRIMITIVE","ALL"]'&&equal(p.before,oldAll)&&equal(p.after,defaults[1].body)||p.id==='["PRIMITIVE","PROPERTY"]'&&p.before===null&&equal(p.after,defaults[6].body));}
function registered(p,d){
 if(d?.docType!=='FOOTPRINT'||!unique(d))return false;
 if(p.qualification===undefined)return legacy(p);
 const expected=spec(p);
 return p.qualification==='native-footprint-defaults-v4.1.71'&&p.before===null&&expected&&equal(p.after,expected.body)&&p.modelSource===source(d)&&/^[a-f0-9]{32}\|[a-f0-9]{32}$/.test(p.modelSource)&&p.modelAnchor===anchor(d);
}
export function managerViewChanges(beforeData,afterData,footprintIds){
 const before=nativeModelRecords(beforeData),after=nativeModelRecords(afterData),changes=[];
 for(const uuid of new Set(footprintIds)){
  const a=before.get(uuid),b=after.get(uuid);
  if(a?.docType!=='FOOTPRINT'||b?.docType!=='FOOTPRINT'||!unique(a)||!unique(b))continue;
  // Only initialize an absent, source-bound configuration set. All existing
  // footprint records, including geometry, rules and net mappings remain exact.
  const fresh=a.rows.every(r=>!spec(r))&&/^[a-f0-9]{32}\|[a-f0-9]{32}$/.test(source(a)??'')&&source(a)===source(b)&&equal(a.tombstones,b.tombstones)&&a.rows.every(r=>{const n=rowsFor(b,r);return n.length===1&&equal(r.body,n[0].body);})&&b.rows.filter(r=>!rowsFor(a,r).length).every(r=>{const p=spec(r);return p&&equal(p.body,r.body);});
  for(const r of b.rows){
   const old=rowsFor(a,r)[0];if(old&&equal(old.body,r.body))continue;
   const p={uuid,type:r.type,id:r.id,before:old?.body??null,after:r.body};
   if(fresh&&spec(r))changes.push({...p,qualification:'native-footprint-defaults-v4.1.71',modelSource:source(a),modelAnchor:anchor(a),reason:r.type==='NET'?'Exact empty-name default net configuration; no class, differential or equal-length group, default ratline visibility. Connectivity remains in unchanged primitive/PAD_NET records.':'Exact native footprint preview display/color configuration; no geometry or rules changed.'});
   else if(legacy(p))changes.push({...p,reason:'Observed native Device Manager preview display filter only; all geometric and dependency records remain exact.'});
  }
 }
 return changes;
}

// Only reverse previously adopted exact bodies. Missing/duplicate/changed
// models, extra fields, net settings and geometry never acquire an exception.
export function managerViewRestorations(beforeData,afterData,priorChanges){
 const before=nativeModelRecords(beforeData),after=nativeModelRecords(afterData),changes=[];
 for(const p of priorChanges){const a=before.get(p.uuid),b=after.get(p.uuid);if(!registered(p,a)||!registered(p,b))continue;const old=rowsFor(a,p),now=rowsFor(b,p);if(old.length!==1||!equal(old[0].body,p.after))continue;if(p.before===null?now.length===0:now.length===1&&equal(now[0].body,p.before))changes.push({...p,before:p.after,after:p.before,reason:'Exact restoration of previously registered footprint configuration; all other records remain compared.'});}
 return changes;
}

export function passivePresentationFingerprint(data,knownChanges){
 const map=nativeModelRecords(data),docs=[],normalized=[],issues=[];
 for(const p of knownChanges)if(!map.has(p.uuid))issues.push({code:'PASSIVE_PREVIEW_MODEL_MISSING',uuid:p.uuid});
 for(const [uuid,doc]of map){
  const rows=doc.rows.map(r=>({...r}));
  if(!unique(doc))issues.push({code:'PASSIVE_PREVIEW_DUPLICATE_RECORD',uuid});
  for(const p of knownChanges.filter(p=>p.uuid===uuid)){
   if(!registered(p,doc)){issues.push({code:'PASSIVE_PREVIEW_NORMALIZATION_UNPROVEN',uuid,id:p.id});continue;}
   const found=rowsFor(doc,p),index=rows.findIndex(r=>r.type===p.type&&r.id===p.id),r=rows[index];
   if(!found.length&&p.before===null)continue;
   if(found.length!==1||!r||!equal(r.body,p.before)&&!equal(r.body,p.after)){issues.push({code:'PASSIVE_PREVIEW_VARIANT_UNSUPPORTED',uuid,id:p.id});continue;}
   if(equal(r.body,p.after)){normalized.push({uuid,type:p.type,id:p.id,actual:r.body,canonical:p.before});if(p.before===null)rows.splice(index,1);else rows[index]={...r,body:p.before};}
  }
  docs.push({uuid,docType:doc.docType,records:sorted(rows)});
 }
 docs.sort((a,b)=>(a.docType+'/'+a.uuid).localeCompare(b.docType+'/'+b.uuid));
 return{status:issues.length?'mismatch':'matched',issues,sha256:fingerprint(docs),normalized,coverage:'Full active native records; only exact registered source-bound footprint configuration bodies canonicalized. Raw archive SHA, geometry, network mappings and deletion proofs retained separately.'};
}
