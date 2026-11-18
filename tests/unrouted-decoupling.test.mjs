import test from 'node:test';
import assert from 'node:assert/strict';
import {decouplingDelta} from '../src/unrouted-decoupling.mjs';
import {scripts} from '../src/native-scripts.mjs';
import {factsScript} from '../src/native-facts.mjs';
const run=(source,eda)=>new (Object.getPrototypeOf(async function(){}).constructor)('eda','return await '+source)(eda);
const pin=(ref,number)=>({ref,pin:number});
test('an unrouted decoupling delta releases exactly the named pin and leaves old nets and parts untouched',()=>{
 const original={components:[{ref:'U1'},{ref:'J1'}],openPins:[pin('U1','1'),pin('U1','2')],nets:[{name:'GND',endpoints:[pin('J1','1')]}],nc:[],notes:[]};
 const wanted=structuredClone(original);wanted.components.push({ref:'C1',designator:'C1'});wanted.openPins.shift();
 wanted.nets[0].endpoints.push(pin('C1','2'));wanted.nets.push({name:'VCC',junction:[15,10],endpoints:[pin('U1','1'),pin('C1','1')]});
 assert.deepEqual(decouplingDelta(original,wanted).pin,pin('U1','1'));
 for(const mutate of [c=>c.notes.push({text:'other'}),c=>c.components[0].ref='other',c=>c.openPins.pop(),c=>c.nets[0].endpoints.shift(),c=>c.nets[1].endpoints[0].pin='2']){
  const invalid=structuredClone(wanted);mutate(invalid);assert.throws(()=>decouplingDelta(original,invalid));
 }
});
test('project readiness uses the observed UUID and rejects a different project after the await',async()=>{
 let key='p';const wait=[];const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:key,data:[{uuid:'page',itemType:'Schematic Page'}]}),waitForReady:async id=>{wait.push(id);return true;}}};
 assert.equal((await run(scripts.project({waitForReady:true}),eda)).projectReadiness,'dmt_Project.waitForReady');assert.deepEqual(wait,['p']);
 eda.dmt_Project.waitForReady=async()=>{key='q';return true;};assert.equal((await run(scripts.project({waitForReady:true}),eda)).code,'TARGET_CHANGED_DURING_READ');
});
test('document readiness uses the returned tab, and rejects timeouts and active-document drift',async()=>{
 const target={kind:'pcb',expectedProjectUuid:'p',documentUuid:'b'},active={uuid:'b',parentProjectUuid:'p',documentType:3,tabId:'native-tab'};
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'p',data:[{uuid:'b',itemType:'PCB'}]})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>active},dmt_EditorControl:{waitForDocumentReady:async tab=>tab===active.tabId}};
 assert.equal((await run(scripts.focus(target),eda)).documentReadiness,'dmt_EditorControl.waitForDocumentReady');
 eda.dmt_EditorControl.waitForDocumentReady=async()=>false;assert.equal((await run(scripts.focus(target),eda)).code,'DOCUMENT_WAIT_TIMEOUT');
 eda.dmt_EditorControl.waitForDocumentReady=async()=>{active.parentProjectUuid='other';return true;};assert.equal((await run(scripts.focus(target),eda)).code,'DOCUMENT_NOT_READY_OR_CHANGED');
});
test('native library geometry reads the requested scope and exposes mismatched/incomplete models',async()=>{
 const bbox={minX:0,minY:0,maxX:8,maxY:4},geometry={uuid:'model',bodyBBox:bbox,fullBBox:bbox,pads:[{padId:'id1',padNumber:'1',x:0,y:0,width:2,height:2,rotation:0}]};
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'p'})},lib_Footprint:{getGeometry:async(model,library)=>{assert.equal(model,'model');assert.equal(library,'project');return geometry;}}};
 const script=factsScript({operation:'model_geometry',kind:'footprint',expectedProjectUuid:'p',libraryUuid:'project',modelUuid:'model'});
 assert.deepEqual((await run(script,eda)).geometry,geometry);geometry.pads[0].width=0;assert.equal((await run(script,eda)).code,'MODEL_GEOMETRY_INCOMPLETE');
 geometry.uuid='other';assert.equal((await run(script,eda)).code,'MODEL_GEOMETRY_IDENTITY_UNPROVEN');
 delete eda.lib_Footprint.getGeometry;assert.equal((await run(script,eda)).status,'unsupported');
});
