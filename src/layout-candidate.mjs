import {fingerprint} from './drawing.mjs';
import {pcbSnapshot} from './pcb.mjs';
import {routingScript,readOwnedRouting} from './p3.mjs';
import {persist} from './workflow.mjs';
import {planLayout} from './layout.mjs';
import {verifyBoard,verifyLayoutSnapshot,unresolvedActions} from './pcb-validation.mjs';
import {capturePlacementArchives,comparePlacementArchives} from './placement-evidence.mjs';
const same=(a,b)=>fingerprint(a)===fingerprint(b);
const sameArchives=(a,b)=>same(a.pcb,b.pcb)&&same(a.schematic,b.schematic);
const document=(a,p)=>a.jlc_eda_read_document({...p,documentUuid:p.pcbDocumentUuid,kind:'pcb',includePins:true,includeGeometry:true,limit:200});
export async function controlledLayout(a,p,ctx){
 const {r,dir}=ctx;r.pcbActions??={};const key='layout/'+p.requestId,hash=fingerprint({layout:p.layout,strategy:p.strategy}),old=r.pcbActions[key];
 if(old&&old.hash!==hash)return {status:'failed',code:'REQUEST_CONFLICT'};
 if(p.phase==='retry_rejected')return {status:'unknown',code:'LAYOUT_CANDIDATE_REPLAY_FORBIDDEN'};
 if(old){
  const doc=await document(a,p),native=await readOwnedRouting(a,p),archives=await capturePlacementArchives(a,p);
  const preservation=comparePlacementArchives(old.beforeArchives,archives,{documentUuid:p.pcbDocumentUuid,beforeDocument:old.beforeDocument,afterDocument:doc,strategy:old.strategy});
  const board=verifyBoard(old.plan,native,old.beforeOutline),scope=doc.status==='ok'&&doc.truncated===false&&doc.components.length===old.beforeDocument.components.length&&native.objects.every(x=>x.layer===11),stable=old.afterArchives? same(archives.pcb,old.afterArchives.pcb)&&same(archives.schematic,old.afterArchives.schematic):true;
  const quality=old.strategy==='adjust'?verifyLayoutSnapshot(old.plan,doc,native,old.beforeOutline):planLayout({...p.layout,components:p.layout.components.map(c=>{const actual=doc.components.find(x=>x.uniqueId===c.uniqueId);return {...c,x:actual?.x*(p.layout.unit==='mm'?.0254:1),y:actual?.y*(p.layout.unit==='mm'?.0254:1),rotation:actual?.rotation,fixed:actual?.primitiveLock};})},doc);
  const returned=old.nativeResult?.status==='ok'||old.nativeResult?.code==='AUTO_LAYOUT_API_UNAVAILABLE';
  const matched=returned&&scope&&stable&&preservation.status==='matched'&&board.status==='matched'&&(old.strategy!=='adjust'||quality.status==='matched');
  const result={status:matched?'ok':'unknown',code:matched?undefined:'LAYOUT_CANDIDATE_READBACK_UNVERIFIED',strategy:old.strategy,nativeResult:old.nativeResult,preservation,board,scope,stable,quality,document:doc,native,nativeMutationReplayed:false,candidateCaptured:matched&&old.strategy==='auto_candidate',adopted:matched&&old.strategy==='adjust'};
  old.lastReadback=result;
  if(matched){old.state='completed';old.after=pcbSnapshot(doc);old.afterDocument=doc;old.afterNative=native;old.afterArchives=archives;old.result=result;
   if(old.strategy==='auto_candidate')r.pcbLayoutCandidate={actionKey:key,after:old.after,archives,adopted:false};
   else{r.pcbLayoutBaseline={after:old.after,plan:old.plan,outline:old.beforeOutline};if(r.pcbLayoutCandidate)r.pcbLayoutCandidate={...r.pcbLayoutCandidate,adopted:true,adoptedBy:key};}
  }else old.state='unknown';await persist(dir,r);return result;
 }
 if(p.phase==='verify')return {status:'failed',code:'LAYOUT_NO_RECORDED_ACTION'};
 if(unresolvedActions(r).length||!r.pcbLayoutBaseline)return {status:'unknown',code:'LAYOUT_KNOWN_BASELINE_REQUIRED'};
 const doc=await document(a,p),native=await readOwnedRouting(a,p),plan=planLayout(p.layout,doc),archives=await capturePlacementArchives(a,p);
 if(doc.status!=='ok'||native.status!=='ok'||native.objects.some(x=>x.layer!==11)||verifyBoard(r.pcbLayoutBaseline.plan,native,r.pcbLayoutBaseline.outline).status!=='matched')return {status:'failed',code:'LAYOUT_CANDIDATE_UNROUTED_SCOPE_REQUIRED'};
 if(!same(plan.board,r.pcbLayoutBaseline.plan.board))return {status:'failed',code:'LAYOUT_EXISTING_OUTLINE_IMMUTABLE'};
 const candidate=r.pcbLayoutCandidate;
 if(candidate&&!candidate.adopted){if(p.strategy!=='adjust'||!same(candidate.after,pcbSnapshot(doc))||!sameArchives(candidate.archives,archives))return {status:'unknown',code:'LAYOUT_CANDIDATE_SOURCE_CHANGED'};}
 else if(verifyLayoutSnapshot(r.pcbLayoutBaseline.plan,doc,native,r.pcbLayoutBaseline.outline).status!=='matched')return {status:'unknown',code:'LAYOUT_BASELINE_CHANGED'};
 if(plan.status!=='ok')return plan;
 const identity=await a.jlc_eda_verify_pcb({...p,circuit:r.circuit});if(identity.status!=='ok'||identity.comparison?.status!=='matched')return {status:'unknown',code:'LAYOUT_IDENTITY_UNVERIFIED',identity};
 const frozen=await capturePlacementArchives(a,p);if(!sameArchives(archives,frozen))return {status:'unknown',code:'LAYOUT_SOURCE_CHANGED_BEFORE_ACTION'};
 if(p.phase==='plan')return {status:'ok',plan,identity,mutationRequested:false,strategy:p.strategy};
 const action={hash,state:'pending',strategy:p.strategy,plan,before:pcbSnapshot(doc),beforeDocument:doc,beforeNative:native,beforeArchives:archives,beforeOutline:r.pcbLayoutBaseline.outline,nativeWaitMs:p.strategy==='auto_candidate'?120000:15000,startedAt:new Date().toISOString()};r.pcbActions[key]=action;await persist(dir,r);
 try{action.nativeResult=await a.invoke(p.sessionId,routingScript({...p,operation:p.strategy==='auto_candidate'?'auto_layout':'layout',plan,beforeComponents:doc.components,preserveOutline:true}),action.nativeWaitMs);action.state='unknown';await persist(dir,r);return controlledLayout(a,{...p,phase:'verify'},ctx);}
 catch(e){action.state='unknown';action.error={code:e.code,message:e.message};await persist(dir,r);throw e;}
}
