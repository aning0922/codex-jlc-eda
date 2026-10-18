import {nativeModelRecords} from './file-model-evidence.mjs';
import {archiveDesignFingerprint} from './resources.mjs';
import {fingerprint} from './drawing.mjs';

const configTypes = new Set(['META','PRIMITIVE','CANVAS','LAYER','LAYER_PHYS','ACTIVE_LAYER',
  'RULE_TEMPLATE','RULE','RULE_SELECTOR','SILK_OPTS','D3_ATTRIBUTE','PREFERENCE','PANELIZE']);
const fail = code => { throw Object.assign(Error(code), {code,status:'failed'}); };
const rowKey = r => r.type+'/'+r.id;
const rowMap = rows => {
  const m = new Map();
  for (const r of rows) { if (m.has(rowKey(r))) fail('PCB_FORCE_DUPLICATE_NATIVE_RECORD'); m.set(rowKey(r),r); }
  return m;
};
export function forcePreflight({pcbData,schematicData,pcbDocumentUuid,verification,inventory,pcbDocument}) {
  if (verification?.comparison?.status !== 'matched' || !verification.netlist?.components?.length
      || pcbDocument?.status !== 'ok' || pcbDocument.truncated !== false || pcbDocument.components.length
      || inventory?.status !== 'ok' || Object.values(inventory.standaloneCounts??inventory.counts??{}).some(n=>n!==0)
      || !Object.keys(inventory.counts??{}).length) fail('PCB_FORCE_INITIAL_EMPTY_REQUIRED');
  const pcbDocs=nativeModelRecords(pcbData), pcb=pcbDocs.get(pcbDocumentUuid);
  if (pcb?.docType!=='PCB' || pcb.tombstones.length || pcb.rows.some(r=>!configTypes.has(r.type)))
    fail('PCB_FORCE_FULL_EMPTY_SOURCE_REQUIRED');
  rowMap(pcb.rows);
  const expected=verification.netlist.components;
  if (expected.some(c=>!c.convertToPcb) || expected.length!==verification.document.components.length)
    fail('PCB_FORCE_ALL_COMPONENTS_REQUIRED');
  const models=[...nativeModelRecords(schematicData).values()].filter(d=>['DEVICE','SYMBOL','FOOTPRINT'].includes(d.docType));
  if (!models.length || models.some(d=>d.tombstones.length)) fail('PCB_FORCE_MODEL_SOURCE_REQUIRED');
  return {pcbDocumentUuid,pcb,models,expected,schematic:archiveDesignFingerprint(schematicData),
    beforePcbDesign:archiveDesignFingerprint(pcbData),inventory,
    scope:'Entire first import into a native-source-proven empty PCB; all verified schematic instances and pin/net/model bindings',
    fingerprint:fingerprint({pcb,models,expected,schematic:archiveDesignFingerprint(schematicData)})};
}

export function compareForceImport(before,{pcbData,schematicData,verification}) {
  const issues=[];
  if (verification?.status!=='ok'||verification.comparison?.status!=='matched') issues.push({code:'PCB_FORCE_ASSIGNMENTS_UNVERIFIED'});
  if (fingerprint(archiveDesignFingerprint(schematicData))!==fingerprint(before.schematic)) issues.push({code:'PCB_FORCE_SCHEMATIC_CHANGED'});
  const docs=nativeModelRecords(pcbData),pcb=docs.get(before.pcbDocumentUuid);
  if (pcb?.docType!=='PCB') return {status:'mismatch',issues:[...issues,{code:'PCB_FORCE_TARGET_MISSING'}]};
  const old=rowMap(before.pcb.rows),now=rowMap(pcb.rows);
  for (const [key,r] of old) if (fingerprint(now.get(key))!==fingerprint(r)) issues.push({code:'PCB_FORCE_NON_TARGET_RECORD_CHANGED',key});
  // First native import emits a paired deletion for its transient unnamed net.
  // Neither identity may have existed in the proven-empty source; no real rule
  // or named net deletion is exempted. Retain the exact pair in the result.
  const transientKeys=['NET/["NET",""]','RULE_SELECTOR/["RULE_SELECTOR",["NET",""]]'];
  const initializationTombstones=pcb.tombstones.filter(r=>transientKeys.includes(rowKey(r))&&!old.has(rowKey(r))&&r.body===null);
  const paired=initializationTombstones.length===2&&new Set(initializationTombstones.map(rowKey)).size===2;
  const remaining=pcb.tombstones.filter(r=>!paired||!initializationTombstones.includes(r));
  if (fingerprint(remaining)!==fingerprint(before.pcb.tombstones)) issues.push({code:'PCB_FORCE_DELETION_CHANGED'});
  const components=verification.pcbDocument?.components??[],ids=new Set(components.map(c=>c.id));
  const nets=new Set(before.expected.flatMap(c=>c.pins.map(p=>p.net)).filter(Boolean));
  for (const [key,r] of now) if (!old.has(key)) {
    let authorized=false;
    if(r.type==='COMPONENT') authorized=ids.has(r.id)&&before.expected.some(c=>c.uniqueId===r.body.attrs?.['Unique ID']);
    if(r.type==='ATTR') authorized=ids.has(r.body.parentId);
    if(r.type==='NET') {let id;try{id=JSON.parse(r.id);}catch{}
      authorized=Array.isArray(id)&&id.length===2&&id[0]==='NET'&&nets.has(id[1]);}
    if(r.type==='PAD_NET') {
      let id;try{id=JSON.parse(r.id);}catch{}
      const c=components.find(c=>c.id===id?.[1]),want=before.expected.find(x=>x.uniqueId===c?.uniqueId);
      authorized=Array.isArray(id)&&id.length===4&&id[0]==='PAD_NET'&&!!c&&want?.pins.some(p=>p.number===id[2]&&p.net===r.body.padNet)
        &&c.pins.some(p=>p.id===c.id+id[3]&&p.number===id[2]&&p.net===r.body.padNet);
    }
    if(!authorized) issues.push({code:'PCB_FORCE_UNEXPECTED_NATIVE_RECORD',key});
  }
  for(const d of docs.values())if(['DEVICE','SYMBOL','FOOTPRINT'].includes(d.docType)){
    const expected=before.models.find(x=>x.uuid===d.uuid);
    if(!expected||fingerprint(expected)!==fingerprint(d))issues.push({code:'PCB_FORCE_MODEL_CHANGED',uuid:d.uuid});
  }
  if (Object.values(verification.inventory?.standaloneCounts??{missing:1}).some(n=>n!==0)) issues.push({code:'PCB_FORCE_NONCOMPONENT_GEOMETRY_ADDED'});
  return {status:issues.length?'mismatch':'matched',issues,expectedInstances:before.expected.length,
    expectedPins:before.expected.reduce((n,c)=>n+c.pins.length,0),expectedNets:[...nets].sort(),
    initializationTombstones:paired?initializationTombstones:[],
    rulesAndOriginalRecordsPreserved:!issues.some(x=>x.code==='PCB_FORCE_NON_TARGET_RECORD_CHANGED'),
    coverage:'Full native PCB configuration, original records, deletion identities, imported model records and complete public pin/net/pad comparison'};
}
