import test from 'node:test';
import assert from 'node:assert/strict';
import {decouplingDelta} from '../src/unrouted-decoupling.mjs';
import {analogPowerDelta,analogPowerRoutes,verifyAnalogDevice,verifyAnalogPins} from '../src/analog-power.mjs';
import {scripts} from '../src/native-scripts.mjs';
import {factsScript} from '../src/native-facts.mjs';
const run=(source,eda)=>new (Object.getPrototypeOf(async function(){}).constructor)('eda','return await '+source)(eda);
const pin=(ref,number)=>({ref,pin:number});
test('H563VI rail and reference share the filtered output and return through one ground link',()=>{
 const config={bead:'FB1',groundLink:'R1',vddaCaps:['C1','C2','C3'],vrefCaps:['C4','C5']};
 const before={components:[{ref:'U1',manufacturerPart:'STM32H563VIT6'},{ref:'J1'}],notes:[],nc:[],
   openPins:['19','20','21','22','23'].map(n=>pin('U1',n)),nets:['+3V3','GNDA','GND'].map((name,i)=>({name,endpoints:[pin('J1',String(i+1))]}))};
 const after=structuredClone(before);after.openPins=[pin('U1','23')];after.nets.push({name:'+3V3A',endpoints:[]});
 const attach=(net,ref,n)=>after.nets.find(v=>v.name===net).endpoints.push({...pin(ref,n),stubLength:15});
 const capRefs=[...config.vddaCaps,...config.vrefCaps];
 for(const ref of [config.bead,config.groundLink,...capRefs])after.components.push({ref,designator:ref});
 for(const ref of capRefs){attach('+3V3A',ref,'1');attach('GNDA',ref,'2');}
 attach('+3V3','FB1','1');attach('+3V3A','FB1','2');attach('GND','R1','1');attach('GNDA','R1','2');
 for(const n of ['19','20','21','22'])attach(n<'21'?'GNDA':'+3V3A','U1',n);
 const d=analogPowerDelta(before,after,config),native=['VSSA','VREF-','VREF+','VDDA'].map((name,i)=>({name,number:String(i+19),net:''}));
 verifyAnalogPins(d,native);assert.throws(()=>verifyAnalogPins(d,native.map(p=>p.number==='20'?{...p,name:'VSSA'}:p)));
 assert.deepEqual(d.terminals.map(e=>e.net).sort(),['+3V3','GND']);
 for(const change of [a=>a.nets.at(-1).endpoints.pop(),a=>a.nets[2].endpoints.pop(),a=>a.nets[0].endpoints.push(pin('U1','21')),
   a=>a.nets[0].endpoints.shift(),a=>a.nets[1].name='GND',a=>a.openPins.pop(),a=>a.components[0].ref='wrong']){
   const bad=structuredClone(after);change(bad);assert.throws(()=>analogPowerDelta(before,bad,config));
 }
 const term=(number,x,y,rotation)=>({number,x,y,rotation}),m=(ref,pins)=>({id:ref,uniqueId:ref,pins});
 const doc={truncated:false,components:[m('U1',native.map((p,i)=>term(p.number,400,120-i*10,180))),
   ...[['FB1',100],['R1',20]].map(([ref,y])=>m(ref,[term('1',0,y,180),term('2',40,y,0)])),
   ...capRefs.map((ref,i)=>m(ref,[term('1',80+i*30,75,90),term('2',80+i*30,45,270)]))]};
 const rails=analogPowerRoutes(d,doc,[]);assert.deepEqual(rails.map(w=>[w.net,w.anchors.length]),[['+3V3A',6],['GNDA',6],['GNDA',2],['+3V3A',2]]);
 assert.throws(()=>analogPowerRoutes(d,doc,[[90,95,90,110]]),/COLLISION/);
 const flipped=structuredClone(doc);
 for(const c of flipped.components.filter(c=>capRefs.includes(c.uniqueId)))for(const p of c.pins){p.y=120-p.y;p.rotation=(p.rotation+180)%360;}
 const reverse=analogPowerRoutes(d,flipped,[]);assert.equal(reverse[0].anchors.length,6);
 assert.throws(()=>analogPowerRoutes(d,flipped,[[221,80,231,80]]),/COLLISION/);
 const component={ref:'FB1',supplierId:'part',manufacturerPart:'bead',footprintUuid:'fp',subPartName:'bead.1',properties:{Name:'={Impedance @ Frequency}'}};
 const device={...component,footprint:{uuid:'fp'},subPartNames:['bead.1'],parameters:{'Supplier Footprint':'0603','Impedance @ Frequency':'600Ω@100MHz','Number of Circuits':'1','DC Resistance(DCR)':'380mΩ','Current Rating':'500mA'}};
 verifyAnalogDevice(config,component,device);device.parameters['DC Resistance(DCR)']='500mΩ';assert.throws(()=>verifyAnalogDevice(config,component,device));
});
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

import {digitalPowerDelta,digitalPowerRoutes,verifyDigitalPins,vcapDelta,verifyVcapPins,verifyVcapCapacitor} from '../src/digital-power.mjs';
function bankFixture(){
 const template={deviceUuid:'cap-model',libraryUuid:'lib',footprintUuid:'fp',subPartName:'MLCC.1',supplierId:'C1',manufacturerPart:'MLCC',properties:{Value:'100nF'}};
 const before={components:[{ref:'U1'},{ref:'C1',designator:'C1',...template}],openPins:['2','3','4','5'].map(n=>pin('U1',n)),
  nets:[{name:'+3V3',endpoints:[pin('U1','1'),pin('C1','1')]},{name:'GND',endpoints:[pin('C1','2')]}],nc:[],notes:[]};
 const after=structuredClone(before);
 after.components.push({ref:'C2',designator:'C2',...template});after.openPins=[pin('U1','5')];
 after.nets[0].endpoints.push(pin('C2','1'),pin('U1','2'));
 after.nets[1].endpoints.push(pin('C2','2'),pin('U1','3'),{...pin('U1','4'),stubLength:10});
 const pairs=[{capacitor:'C2',vdd:'2',vss:'3'}];
 const pins=[['1','VDD','+3V3'],['2','VDD',''],['3','VSS',''],['4','VSS',''],['5','VSSA','']].map(([number,name,net])=>({number,name,net}));
 return {before,after,pairs,pins};
}
test('digital rail completion preserves prior endpoints and checks every digital VDD and VSS against the original silicon pin names',()=>{
 const f=bankFixture(),d=digitalPowerDelta(f.before,f.after,f.pairs);
 verifyDigitalPins(d,f.pins);assert.deepEqual(d.extraGround.map(p=>p.pin),['4']);
 for(const change of [pins=>pins[2].name='VSSA',pins=>pins[1].net='other',pins=>pins[4].name='VSS']){
  const pins=structuredClone(f.pins);change(pins);assert.throws(()=>verifyDigitalPins(d,pins));
 }
 for(const change of [f=>f.after.nets[0].endpoints.pop(),f=>f.after.nets[1].endpoints.shift(),f=>f.after.components.at(-1).properties={Value:'10nF'},f=>f.pairs[0].vss='2']){
  const changed=bankFixture();change(changed);assert.throws(()=>digitalPowerDelta(changed.before,changed.after,changed.pairs));
 }
});
test('each decoupler gets two independently named wires between actual facing pins; other pins and pre-existing wires are obstacles',()=>{
 const f=bankFixture(),d=digitalPowerDelta(f.before,f.after,f.pairs);
 const terminal=(number,x,y,rotation)=>({number,x,y,rotation});
 const doc={truncated:false,components:[
  {uniqueId:'U1',id:'mcu',pins:[terminal('2',80,40,180),terminal('3',80,50,180),terminal('4',80,80,180)]},
  {uniqueId:'C2',id:'cap',pins:[terminal('1',30,20,0),terminal('2',10,20,180)]}
 ]};
 const routes=digitalPowerRoutes(d,doc,[]);
 assert.deepEqual(routes.map(x=>x.net),['+3V3','GND']);
 assert.deepEqual(routes.map(x=>x.anchors.map(a=>a.pin)),[['2','1'],['3','2']]);
 assert.throws(()=>digitalPowerRoutes(d,doc,[[50,37,65,37]]),/COLLISION/);
 doc.components[0].pins.push(terminal('8',55,30,0));assert.throws(()=>digitalPowerRoutes(d,doc,[]),/TOUCHES_ANOTHER_PIN/);
});
test('the H563VI LDO pair releases both VCAP pins onto one rail with two grounded capacitors',()=>{
 const before={components:[{ref:'U1',manufacturerPart:'STM32H563VIT6'}],openPins:['48','98','23'].map(n=>pin('U1',n)),
  nets:[{name:'GND',endpoints:[pin('U1','27')]}],notes:[],nc:[]};
 const after=structuredClone(before),pairs=[{capacitor:'C8',pin:'48'},{capacitor:'C9',pin:'98'}];
 const rail={name:'VCAP',endpoints:[]};after.nets.push(rail);after.openPins=[pin('U1','23')];
 for(const p of pairs){
  after.components.push({ref:p.capacitor,designator:p.capacitor,properties:{Value:'2.2uF'}});
  rail.endpoints.push(pin('U1',p.pin),pin(p.capacitor,'1'));after.nets[0].endpoints.push({...pin(p.capacitor,'2'),stubLength:15});
 }
 const d=vcapDelta(before,after,pairs),pins=pairs.map(p=>({number:p.pin,name:'VCAP',net:''}));
 verifyVcapPins(d,pins);assert.throws(()=>verifyVcapPins(d,[pins[0],{...pins[1],net:'+3V3'}]));
 for(const change of [a=>a.nets[1].name='+3V3',a=>a.nets[0].name='GNDA',a=>a.nets[1].endpoints.pop(),a=>a.nets[0].endpoints.shift(),
   a=>a.components[1].deviceUuid='other',a=>a.components[1].properties.Value='100nF',a=>a.openPins.pop()]){
  const wrong=structuredClone(after);change(wrong);assert.throws(()=>vcapDelta(before,wrong,pairs));
 }
 const parameters={Value:'2.2uF','Temperature Coefficient':'X7R','Supplier Footprint':'0603','Voltage Rating':'10V',Tolerance:'±10%'};
 verifyVcapCapacitor({subPartNames:['cap'],parameters});
 assert.throws(()=>verifyVcapCapacitor({subPartNames:['cap'],parameters:{...parameters,'Voltage Rating':'6.3V'}}));
 const term=(number,x,y,rotation)=>({number,x,y,rotation});
 const doc={truncated:false,components:[{id:'m',uniqueId:'U1',pins:[term('48',80,50,180),term('98',120,80,0)]},
   {id:'a',uniqueId:'C8',pins:[term('1',40,55,0),term('2',10,55,180)]},
   {id:'b',uniqueId:'C9',pins:[term('1',160,75,180),term('2',190,75,0)]}]};
 const routes=digitalPowerRoutes(d,doc,[]);assert.deepEqual(routes.map(w=>[w.net,...w.anchors.map(a=>a.componentId+'.'+a.pin)]),
   [['VCAP','m.48','a.1'],['VCAP','m.98','b.1']]);
 assert.throws(()=>digitalPowerRoutes(d,doc,[[199,70,199,80]]),/COLLISION/);
});
