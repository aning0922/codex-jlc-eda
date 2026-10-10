import {scripts} from './native-scripts.mjs';
import {factsScript} from './native-facts.mjs';
// Same native readers and target guards, composed into one official invoke.
export function connectivityScript(p){return `(async()=>{
 const p=${JSON.stringify(p)},project=await ${scripts.project(p)};
 if(project.status!=='ok')return project;
 const page=project.documents.find(d=>d.uuid===p.schematicPageUuid&&d.itemType==='Schematic Page');
 if(!page)return {status:'failed',code:'DOCUMENT_NOT_IN_TARGET'};
 if(project.documents.filter(d=>d.itemType==='Schematic').length!==1)return {status:'unsupported',code:'MULTI_SCHEMATIC_EXPORT_SCOPE_UNVERIFIED'};
 const pages=project.documents.filter(d=>d.itemType==='Schematic Page'&&d.parentSchematicUuid===page.parentSchematicUuid);
 if(pages.length>8)return {status:'unsupported',code:'SCHEMATIC_PAGE_LIMIT'};
 const pcbDoc=p.pcbDocumentUuid?project.documents.find(d=>d.uuid===p.pcbDocumentUuid&&d.itemType==='PCB'):null;
 if(p.pcbDocumentUuid&&(!pcbDoc||!page.boardName||pcbDoc.boardName!==page.boardName))return {status:'failed',code:'PCB_NOT_ASSOCIATED_WITH_SCHEMATIC'};
 const focusPage=()=>${scripts.focus({...p,documentUuid:p.schematicPageUuid,kind:'schematic'})};
 const focus=await focusPage();if(focus.status!=='ok')return focus;
 const raw=await ${factsScript({...p,documentUuid:p.schematicPageUuid,operation:'netlist'})};if(raw.status!=='ok')return raw;
 const schematic=[];
 const read=async(doc,kind)=>{const params={sessionId:p.sessionId,expectedProjectUuid:p.expectedProjectUuid,documentUuid:doc.uuid,kind,includePins:true,includeGeometry:false,limit:200};
  return await (async()=>{const focusDocument=${getFunction(scripts.focus({}))};const readDocument=${getFunction(scripts.document({}))};const focused=await focusDocument(params);if(focused.status!=='ok')return focused;for(let attempt=0;attempt<4;attempt++){const r=await readDocument(params);if(r.code!=='DOCUMENT_NOT_READY_OR_CHANGED')return {...r,focusAction:focused.focusAction};if(attempt<3)await new Promise(x=>setTimeout(x,250));}return {status:'unknown',code:'DOCUMENT_NOT_READY_OR_CHANGED'};})();};
 for(const doc of pages){const r=await read(doc,'schematic');if(r.status!=='ok')return r;schematic.push(r);}
 let pcb=null;if(pcbDoc){pcb=await read(pcbDoc,'pcb');if(pcb.status!=='ok')return pcb;}
 const refocus=await focusPage();if(refocus.status!=='ok')return refocus;
 const after=await ${factsScript({...p,documentUuid:p.schematicPageUuid,operation:'netlist'})};if(after.status!=='ok')return after;
 const end=await ${scripts.project(p)};if(end.status!=='ok')return end;
 return {status:'ok',projectUuid:p.expectedProjectUuid,schematicUuid:page.parentSchematicUuid,scope:{schematicPages:pages.map(d=>d.uuid),pcbDocumentUuid:pcbDoc?.uuid??null},raw,after,schematic,pcb};
})()`;}
function getFunction(code){return code.slice(1,code.lastIndexOf(')('));}
