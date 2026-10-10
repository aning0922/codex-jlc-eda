async function nativeEco(p){
 const project=await eda.dmt_Project.getCurrentProjectInfo();if(project?.uuid!==p.expectedProjectUuid)return {status:'failed',code:'ECO_NATIVE_PROJECT_MISMATCH'};
 if(p.operation==='prepare_replace'){
  const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(doc?.uuid!==p.schematicPageUuid||doc.parentProjectUuid!==p.expectedProjectUuid||doc.documentType!==1)return {status:'failed',code:'PASSIVE_NATIVE_SCH_MISMATCH'};const c=await eda.sch_PrimitiveComponent.get(p.component.id);if(!c||c.getState_UniqueId()!==p.component.uniqueId||c.getState_Designator()!==p.component.designator)return{status:'failed',code:'PASSIVE_REPLACEMENT_INSTANCE_CHANGED'};eda.sch_SelectControl.clearSelected();await eda.sch_SelectControl.doSelectPrimitives([p.component.id]);const selected=await eda.sch_SelectControl.getAllSelectedPrimitives_PrimitiveId();if(selected.length!==1||selected[0]!==p.component.id)return{status:'unknown',code:'PASSIVE_REPLACEMENT_SELECTION_UNCONFIRMED',selected,nativeDesignMutationRequested:false};await eda.dmt_EditorControl.zoomToSelectedPrimitives();return{status:'ok',selected,current:doc,componentId:p.component.id,uniqueId:p.component.uniqueId,designator:p.component.designator,nativeDesignMutationRequested:false};
 }
 if(p.operation==='reconnect_stub'){
  const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(doc?.uuid!==p.schematicPageUuid||doc.parentProjectUuid!==p.expectedProjectUuid||doc.documentType!==1)return{status:'failed',code:'PASSIVE_NATIVE_SCH_MISMATCH'};
  const c=await eda.sch_PrimitiveComponent.get(p.component.id),wire=await eda.sch_PrimitiveWire.get(p.connection.wireId),port=await eda.sch_PrimitiveComponent.get(p.connection.labelId);if(!c||c.getState_UniqueId()!==p.component.uniqueId||!wire||wire.getState_Net()!==p.oldNet||!port||port.getState_Net()!==p.oldNet)return{status:'failed',code:'PASSIVE_RECONNECT_OLD_VALUE_CHANGED'};
  const attribute=await eda.sch_PrimitiveAttribute.get(p.connection.nameAttributeId);if(!attribute||attribute.getState_ParentPrimitiveId()!==p.connection.labelId||attribute.getState_Key()!=='Name'||attribute.getState_Value()!==p.oldNet)return{status:'failed',code:'PASSIVE_PORT_NAME_ATTRIBUTE_CHANGED'};const w=await eda.sch_PrimitiveWire.modify(p.connection.wireId,{net:p.newNet});if(!w)return{status:'unknown',code:'PASSIVE_WIRE_MODIFY_UNCONFIRMED'};const changed=await eda.sch_PrimitiveAttribute.modify(p.connection.nameAttributeId,{value:p.newNet});if(!changed)return{status:'unknown',code:'PASSIVE_PORT_NAME_MODIFY_UNCONFIRMED'};return{status:'ok',wireId:p.connection.wireId,labelId:p.connection.labelId,newNet:p.newNet,portNameModified:true};
 }
 if(p.operation==='finish_reconnect_port'){
  const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(doc?.uuid!==p.schematicPageUuid||doc.parentProjectUuid!==p.expectedProjectUuid||doc.documentType!==1)return{status:'failed',code:'PASSIVE_NATIVE_SCH_MISMATCH'};
  const c=await eda.sch_PrimitiveComponent.get(p.component.id),wire=await eda.sch_PrimitiveWire.get(p.connection.wireId),port=await eda.sch_PrimitiveComponent.get(p.connection.labelId);if(!c||c.getState_UniqueId()!==p.component.uniqueId||!wire||wire.getState_Net()!==p.newNet||!port)return{status:'failed',code:'PASSIVE_RECONNECT_PARTIAL_STATE_CHANGED'};
  const attribute=await eda.sch_PrimitiveAttribute.get(p.connection.nameAttributeId);if(!attribute||attribute.getState_ParentPrimitiveId()!==p.connection.labelId||attribute.getState_Key()!=='Name'||attribute.getState_Value()!==p.oldNet)return{status:'failed',code:'PASSIVE_PORT_NAME_ATTRIBUTE_CHANGED'};const changed=await eda.sch_PrimitiveAttribute.modify(p.connection.nameAttributeId,{value:p.newNet});return{status:changed?'ok':'unknown',labelId:p.connection.labelId,newNet:p.newNet,wireMutationRequested:false,portNameModified:!!changed};
 }
 if(p.operation==='place_pcb'){
  const doc=await eda.dmt_SelectControl.getCurrentDocumentInfo();if(doc?.uuid!==p.pcbDocumentUuid||doc.parentProjectUuid!==p.expectedProjectUuid||doc.documentType!==3)return {status:'failed',code:'ECO_NATIVE_PCB_MISMATCH'};
  const c=await eda.pcb_PrimitiveComponent.get(p.component.id);if(!c||c.getState_UniqueId()!==p.component.uniqueId||c.getState_Designator()!==p.component.designator||c.getState_Footprint()?.uuid!==p.component.footprint.uuid)return {status:'failed',code:'ECO_NEW_COMPONENT_CHANGED'};
  for(const k of ['X','Y','Rotation','Layer','PrimitiveLock']){const v=c['getState_'+k](),expected=p.component[{X:'x',Y:'y',Rotation:'rotation',Layer:'layer',PrimitiveLock:'primitiveLock'}[k]];if(typeof v==='number'?Math.abs(v-expected)>.0001:v!==expected)return {status:'failed',code:'ECO_NEW_COMPONENT_POSE_CHANGED',field:k};}
  const result=await eda.pcb_PrimitiveComponent.modify(p.component.id,{x:p.pose.x,y:p.pose.y,rotation:p.pose.rotation,layer:1,primitiveLock:p.pose.primitiveLock??true});return {status:result?'ok':'unknown',primitiveId:result?.getState_PrimitiveId(),x:result?.getState_X(),y:result?.getState_Y(),rotation:result?.getState_Rotation(),layer:result?.getState_Layer(),primitiveLock:result?.getState_PrimitiveLock()};
 }
 if(p.operation==='part_files'){
  const files={};for(const [kind,method,uuid] of [['symbol','getSymbolFileBySymbolUuid',p.device.symbol.uuid],['footprint','getFootprintFileByFootprintUuid',p.device.footprint.uuid]]){
   if(typeof eda.sys_FileManager[method]!=='function')return {status:'unsupported',code:'ECO_MODEL_FILE_API_MISSING',kind};
   const f=await eda.sys_FileManager[method](uuid,p.device.libraryUuid,'elibz');if(!f||f.size>2*1024*1024)return {status:'unknown',code:'ECO_MODEL_FILE_UNAVAILABLE',kind};let data='';for(const b of new Uint8Array(await f.arrayBuffer()))data+=String.fromCharCode(b);files[kind]={name:f.name,bytes:f.size,mimeType:f.type,data:btoa(data),uuid};
  }
  if((await eda.dmt_Project.getCurrentProjectInfo())?.uuid!==p.expectedProjectUuid)return {status:'unknown',code:'ECO_TARGET_CHANGED_DURING_READ'};return {status:'ok',files};
 }
 return {status:'unsupported',code:'ECO_NATIVE_OPERATION_NOT_IMPLEMENTED'};
}
export const ecoScript=p=>'('+nativeEco.toString()+')('+JSON.stringify(p)+')';
