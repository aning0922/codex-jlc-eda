// Fixed public-SDK operations; no caller-provided code or project-specific names.
async function nativeIncrement(p){let mutationRequested=false;try{
 const matches=async()=>{const pr=await eda.dmt_Project.getCurrentProjectInfo(),doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();return pr?.uuid===p.expectedProjectUuid&&doc?.uuid===p.pcbDocumentUuid&&doc.parentProjectUuid===p.expectedProjectUuid&&doc.documentType===3;};
 if(p.operation==='inspect_model'){if(p.editorTabId)await eda.dmt_EditorControl.activateDocument(p.editorTabId);if((await eda.dmt_Project.getCurrentProjectInfo())?.uuid!==p.expectedProjectUuid)return {status:'failed',code:'INCREMENT_PROJECT_MISMATCH'};return {status:'ok',current:await eda.dmt_SelectControl.getCurrentDocumentInfo(),tree:await eda.dmt_EditorControl.getSplitScreenTree(),source:await eda.sys_FileManager.getDocumentSource()};}
 if(!await matches())return {status:'failed',code:'INCREMENT_NATIVE_TARGET_MISMATCH'};
 if(p.operation==='instance_model'){
  const active=await eda.dmt_EditorControl.activateDocument(p.editorTabId);if(!active)return {status:'failed',code:'INCREMENT_INSTANCE_EDITOR_GONE'};const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo(),tree=await eda.dmt_EditorControl.getSplitScreenTree(),tab=tree.tabs?.find(x=>x.tabId===p.editorTabId);if(doc.uuid!==p.editorUuid||doc.documentType!==4||tab?.data?.isProjectLib!==true||tab.data.pid!==p.expectedProjectUuid||p.editorUuid!==p.pcbDocumentUuid+'_'+p.editorUuid.split('_').at(-1))return {status:'failed',code:'INCREMENT_INSTANCE_EDITOR_CHANGED'};
  const before=await eda.sys_FileManager.getDocumentSource();let primitive;
  if(p.modelOperation==='pad'||p.modelOperation==='pad_precise'){const pad=await eda.pcb_PrimitivePad.get(p.padId);if(!pad||String(pad.getState_PadNumber())!==String(p.pad.num))return {status:'failed',code:'INCREMENT_MODEL_PAD_CHANGED'};mutationRequested=true;primitive=await eda.pcb_PrimitivePad.modify(p.padId,{...(p.modelOperation==='pad_precise'?{pad:['RECT',p.pad.defaultPad.width,p.pad.defaultPad.height,p.pad.defaultPad.radius]}:{}),solderMaskAndPasteMaskExpansion:{topSolderMask:p.pad.topSolderExpansion,bottomSolderMask:p.pad.bottomSolderExpansion,topPasteMask:-Math.max(p.pad.defaultPad.width,p.pad.defaultPad.height),bottomPasteMask:p.pad.bottomPasteExpansion}});}
  else if(p.modelOperation==='fill'){const ps=p.points,polygon=eda.pcb_MathPolygon.createComplexPolygon([[...ps[0],'L',...ps.slice(1).flat(),...ps[0]]]);if(!polygon)return {status:'failed',code:'INCREMENT_MODEL_POLYGON_INVALID'};mutationRequested=true;primitive=await eda.pcb_PrimitiveFill.create(p.layer,polygon,null,0,0,false);}
  else return {status:'failed',code:'INCREMENT_INSTANCE_OPERATION_UNSUPPORTED'};
  await new Promise(r=>setTimeout(r,150));const after=await eda.sys_FileManager.getDocumentSource(),saved=await eda.pcb_Document.save();return {status:primitive?'returned':'unknown',primitiveId:primitive?.getState_PrimitiveId(),before,after,saved,scope:tab.data,modelOperation:p.modelOperation};
 }
 if(p.operation==='probe_binding'){const component=await eda.pcb_PrimitiveComponent.get(p.componentId),attr=await eda.pcb_PrimitiveAttribute.get(p.attributeId);return {status:'ok',footprint:component?.getState_Footprint(),id:attr?.getState_PrimitiveId(),key:attr?.getState_Key(),value:attr?.getState_Value(),fontSize:attr?.getState_FontSize(),rotation:attr?.getState_Rotation()};}
 if(p.operation==='prepare_model'){await eda.pcb_SelectControl.doSelectPrimitives([p.componentId]);await eda.dmt_EditorControl.zoomToSelectedPrimitives();return {status:'ok',componentId:p.componentId,tree:await eda.dmt_EditorControl.getSplitScreenTree(),current:await eda.dmt_SelectControl.getCurrentDocumentInfo()};}
 if(p.operation==='primitive'){
  const o=p.edit,api=eda['pcb_Primitive'+({LINE:'Line',VIA:'Via',ATTR:'Attribute',NEW_LINE:'Line',NEW_VIA:'Via'}[o.kind])];if(!api)return {status:'failed',code:'INCREMENT_EDIT_KIND_UNSUPPORTED'};
  if(!o.kind.startsWith('NEW_')){const old=await api.get(o.id);if(!old||!old.getState_PrimitiveId||old.getState_PrimitiveId()!==o.id)return {status:'failed',code:'INCREMENT_OLD_PRIMITIVE_MISSING'};
   const b=o.before;if(o.kind==='ATTR'&&b.key==='Footprint'){const owner=await eda.pcb_PrimitiveComponent.get(b.parentId);if(owner?.getState_Footprint()?.uuid!==b.value)return {status:'failed',code:'INCREMENT_FOOTPRINT_BINDING_CHANGED',nativeMutationRequested:false};}const checks=o.kind==='LINE'?{Net:b.netName,Layer:b.layerId,StartX:b.startX,StartY:b.startY,EndX:b.endX,EndY:b.endY,LineWidth:b.width,PrimitiveLock:b.locked}:o.kind==='VIA'?{Net:b.netName,X:b.centerX,Y:b.centerY,HoleDiameter:Math.round(b.holeDiameter/2*10+1e-10)/10*2,Diameter:Math.round(b.viaDiameter/2*10+1e-10)/10*2,PrimitiveLock:b.locked}:{Key:b.key,...(b.key==='Footprint'?{}:{Value:b.value}),ParentPrimitiveId:b.parentId,FontSize:b.fontSize,LineWidth:b.strokeWidth};
   for(const [k,v]of Object.entries(checks)){const actual=old['getState_'+k]?.();if(typeof v==='number'&&typeof actual==='number'?Math.abs(v-actual)>.00011:v!==actual)return {status:'failed',code:'INCREMENT_OLD_TARGET_VALUE_CHANGED',nativeMutationRequested:false,field:k,expected:v,actual};}
  }
  let result;mutationRequested=true;
  if(o.kind==='NEW_LINE')result=await api.create(o.net,o.layer,...o.points[0],...o.points[1],o.width,o.locked);
  else if(o.kind==='NEW_VIA')result=await api.create(o.net,...o.point,o.holeDiameter,o.diameter,0,null,null,o.locked);
  else if(o.after===null)result=await api.delete(o.id);
  else result=await api.modify(o.id,o.apiProperty);
  await new Promise(r=>setTimeout(r,120));
  return {status:await matches()?'returned':'unknown',primitiveId:result?.getState_PrimitiveId?.()??o.id??null,result:typeof result==='boolean'?result:null};
 }
 return {status:'unsupported',code:'INCREMENT_NATIVE_OPERATION_UNSUPPORTED'};
 }catch(e){return {status:mutationRequested?'unknown':'failed',code:'INCREMENT_NATIVE_EXCEPTION',message:e?.message??String(e),error:JSON.stringify(e),nativeMutationRequested:mutationRequested};}
}
export const incrementScript=p=>'('+nativeIncrement.toString()+')('+JSON.stringify(p)+')';
