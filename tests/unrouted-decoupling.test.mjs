import test from 'node:test';
import assert from 'node:assert/strict';
import {decouplingDelta} from '../src/unrouted-decoupling.mjs';
import {analogPowerDelta,analogPowerRoutes,verifyAnalogDevice,verifyAnalogPins} from '../src/analog-power.mjs';
import {usbBackupDelta,usbBackupRoutes,verifyUsbBackupPins,verifyUsbBackupDevice,verifyHolderSymbol,verifyPolarizedFootprint} from '../src/usb-backup.mjs';
import {lseDelta,lseRoutes,verifyLsePins} from '../src/lse.mjs';
import {checkHolderCopper,holderLandPlan,patchHolderArchive,verifyHolderCam} from '../src/holder-land.mjs';
import {bootResetDelta,bootResetRoutes} from '../src/boot-reset.mjs';
import {crystalLandPlan,crystalBoardCopper} from '../src/crystal-land.mjs';

test('H563 reset discharges to ground and a separate momentary boot key asserts the pulled-down input',()=>{
 const cfg={crystal:'Y1',pullDown:'R1',filter:'C1',resetSwitch:'SW1',bootSwitch:'SW2'};
 const pin=(ref,pin)=>({ref,pin}),old={components:[{ref:'U1',manufacturerPart:'STM32H563VIT6'},{ref:'Y1',supplierId:'C108687'}],
  notes:[],nc:[pin('Y1','2'),pin('Y1','3')],openPins:['14','94','95'].map(n=>pin('U1',n)),nets:[{name:'GND',endpoints:[pin('U1','10')]},{name:'+3V3',endpoints:[pin('U1','11')]}]};
 const next=structuredClone(old);next.openPins=[pin('U1','95')];next.components.push(...['C1','R1','SW1','SW2'].map(ref=>({ref,designator:ref})));
 next.nets[0].endpoints.push(pin('R1','2'),pin('C1','2'),pin('SW1','2'));next.nets[1].endpoints.push(pin('SW2','2'));
 next.nets.push({name:'BOOT0',endpoints:[pin('U1','94'),pin('R1','1'),pin('SW2','1')]},{name:'NRST',endpoints:[pin('U1','14'),pin('C1','1'),pin('SW1','1')]});
 const d=bootResetDelta(old,next,cfg);assert.deepEqual(d.assignments.map(p=>p.pin),['14','94']);
 const pn=(number,x,y,rotation)=>({number,x,y,rotation});
 const doc={truncated:false,components:[{id:'u',uniqueId:'U1',pins:[pn('14',800,620,180),pn('94',980,690,0)]},
   ...['SW1','C1','R1','SW2'].map((ref,i)=>({id:ref,uniqueId:ref,pins:[pn('1',90+100*i,120,90),pn('2',90+100*i,70,270)]}))]};
 assert.equal(bootResetRoutes(d,doc,[]).length,7);assert.throws(()=>bootResetRoutes(d,doc,[[780,610,780,630]]),/COLLISION/);
 next.nets[0].endpoints.push(next.nets[1].endpoints.pop());assert.throws(()=>bootResetDelta(old,next,cfg),/ASSIGNMENT/);
});
test('SSP-T7-F increases the two row gaps symmetrically and limits archive edits to the four bound pad centers',()=>{
 const source='f9d238b18e8a4114a6eaf8987aa86d60|0819f05c4eef4c71ace90d822a990e87';
 const line=(type,id,body)=>JSON.stringify({type,id})+'||'+JSON.stringify(body)+'|',co=[[-124.02,-16.735],[124.02,-16.735],[124.02,16.735],[-124.02,16.735]];
 const rows=co.map(([centerX,centerY],i)=>line('PAD','p'+i,{num:String(i+1),centerX,centerY,layerId:1,hole:null,specialPad:[],padAngle:i%2?90:270,padOffsetX:-.001,padOffsetY:.004,defaultPad:{padType:'RECT',width:23.62,height:47.24,radius:0}}));
 const lines=[line('DOCHEAD','m',{uuid:'m',docType:'FOOTPRINT'}),line('META','meta',{source}),...rows,line('SILK','s',{width:2})];
 const archive=Buffer.from(zipSync({'design.epru':strToU8(lines.join('\n'))}));
 const c={id:'y',uniqueId:'Y1',designator:'Y1',x:10,y:20,rotation:0,layer:1,supplierId:'C108687',manufacturerPart:'SSP-T7-F 32.768kHz 20PPM12.5pF',footprint:{uuid:'m'},
   pins:co.map(([x,y],i)=>({number:String(i+1),id:'yp'+i,layer:1,hole:null,padShape:['RECT',23.6,47.2,0],net:['LSE_IN','','','LSE_OUT'][i],x:10+x,y:20+y}))};
 const p=crystalLandPlan(archive.toString('base64'),[c],'Y1'),changed=strFromU8(unzipSync(patchHolderArchive(archive,p))['design.epru']).split('\n');
 assert.deepEqual(changed.slice(0,2),lines.slice(0,2));assert.equal(changed.at(-1),lines.at(-1));
 for(const e of p.pads){assert.deepEqual({...e.after,centerY:e.before.centerY},e.before);c.pins.find(pin=>pin.number===e.number).y=c.y+e.after.centerY;}
 const physical=crystalBoardCopper(p,c);assert.ok(Math.abs(physical[3].y-physical[0].y-physical[0].h-.3)<1e-8);
 c.pins[0].y+=1;assert.throws(()=>crystalBoardCopper(p,c),/POSITION/);
});
import {zipSync,unzipSync,strToU8,strFromU8} from 'fflate';
import {scripts} from '../src/native-scripts.mjs';
import {factsScript} from '../src/native-facts.mjs';
const run=(source,eda)=>new (Object.getPrototypeOf(async function(){}).constructor)('eda','return await '+source)(eda);
const pin=(ref,number)=>({ref,pin:number});
test('the LSE uses crystal leads 1/4; both support leads stay externally open',()=>{
 const config={crystal:'Y1',loadIn:'C1',loadOut:'C2',holder:'BT1'};
 const before={components:[{ref:'U1',manufacturerPart:'STM32H563VIT6'},{ref:'BT1',supplierId:'C5377561'}],notes:[],nc:[],
  openPins:['8','9','10'].map(n=>pin('U1',n)),nets:[{name:'GND',endpoints:[pin('BT1','1')]}]};
 const after=structuredClone(before);after.openPins=[pin('U1','10')];after.nc=['2','3'].map(n=>pin('Y1',n));
 for(const ref of ['Y1','C1','C2'])after.components.push({ref,designator:ref});
 after.nets[0].endpoints.push(pin('C1','2'),pin('C2','2'));
 for(const [name,n,x,c] of [['LSE_IN','8','1','C1'],['LSE_OUT','9','4','C2']])after.nets.push({name,endpoints:[pin('U1',n),pin('Y1',x),pin(c,'1')]});
 const d=lseDelta(before,after,config),native=[{number:'8',name:'PC14-OSC32_IN',net:''},{number:'9',name:'PC15-OSC32_OUT',net:''}];verifyLsePins(d,native);
 for(const change of [a=>a.nets[2].endpoints[1].pin='2',a=>a.nc.pop(),a=>a.nets[0].endpoints.shift(),a=>a.nets[0].name='GNDA',a=>a.openPins.pop()]){
  const wrong=structuredClone(after);change(wrong);assert.throws(()=>lseDelta(before,wrong,config));
 }
 const pn=(number,x,y,rotation)=>({number,x,y,rotation}),part=(id,pins)=>({id,uniqueId:id,pins});
 const doc={truncated:false,components:[part('Y1',[pn('1',100,100,180),pn('4',160,100,0)]),part('C1',[pn('1',50,90,90),pn('2',50,55,270)]),
   part('C2',[pn('1',210,90,90),pn('2',210,55,270)]),part('U1',[pn('8',400,120,180),pn('9',400,110,180)])]};
 assert.deepEqual(lseRoutes(d,doc,[]).map(x=>x.net),['LSE_IN','LSE_OUT','GND','LSE_IN','LSE_OUT']);
 assert.throws(()=>lseRoutes(d,doc,[[73,94,73,106]]),/COLLISION/);
});
test('BS-08 pad 2 preserves its anchor, mask, offsets and rotation while rounding only the two outward corners',()=>{
 const pad=(num,w,h,x,angle)=>({num,layerId:1,centerX:x,centerY:0,padAngle:angle,padOffsetX:.001,padOffsetY:-.005,hole:null,specialPad:[],defaultPad:{padType:'RECT',width:w/.0254,height:h/.0254,radius:0}});
 const source='2dd9463ac7dc49cb95299c9c9e798fbe|0819f05c4eef4c71ace90d822a990e87',line=(type,id,body)=>JSON.stringify({type,id})+'||'+JSON.stringify(body)+'|';
 const lines=[line('DOCHEAD','m',{uuid:'m',docType:'FOOTPRINT'}),line('META','meta',{source}),line('PAD','p1',pad('1',4.5,2.4,0,0)),line('PAD','p2',pad('2',3.05,3.4,21.175/.0254,180))];
 const zip=Buffer.from(zipSync({'design.epru':strToU8(lines.join('\n')),'other':strToU8('unchanged')}));
 const c={uniqueId:'BT1',designator:'BT1',id:'bt',supplierId:'C5377561',manufacturerPart:'BS08A3B0J001-TP',rotation:0,layer:1,footprint:{uuid:'m'},pins:[{id:'btp1',number:'1',net:'GND'},{id:'btp2',number:'2',net:'VBAT_CELL'}]};
 const p=holderLandPlan(zip.toString('base64'),[c],'BT1'),edited=unzipSync(patchHolderArchive(zip,p)),out=strFromU8(edited['design.epru']).split('\n');
 assert.deepEqual(out.slice(0,3),lines.slice(0,3));assert.equal(strFromU8(edited.other),'unchanged');assert.equal(p.after.defaultPad.path.filter(x=>x==='ARC').length,2);
 assert.deepEqual({...p.after,defaultPad:p.before.defaultPad},p.before);assert.ok(Math.abs(p.endFlatMm-.8)<.000001);
 const center=p.before.centerX+p.before.padOffsetX,top=p.before.centerY+p.before.padOffsetY+p.before.defaultPad.height/2;
 const [left,y,,rightTangent]=p.after.defaultPad.path;
 assert.ok(Math.abs(left-(center-p.before.defaultPad.width/2))<1e-7&&y===top&&rightTangent>center);
 const live={x:center,y:p.before.centerY,padShape:['POLYGON',p.after.defaultPad.path]};
 const copper=checkHolderCopper(p,{x:0,y:0},live);assert.ok(copper.outerRadiiMm.every(r=>Math.abs(r-1.3)<1e-6));
 assert.throws(()=>checkHolderCopper(p,{x:100,y:0},live),/CONTOUR/);
 assert.throws(()=>holderLandPlan(zip.toString('base64'),[c,{...c,uniqueId:'BT2'}],'BT1'));
});
test('the holder CAM comparison requires the two physical clockwise corners and an unchanged drill file',()=>{
 const headers='G04 Land*\n%FSLAX45Y45*%\n%MOMM*%\n%ADD10R,3.05X3.4*%\nG75*\n';
 const original='D10*\nG01X152500Y170000D03*\n',region='G36*\nG01X0Y340000D02*\nG01X175000Y340000D01*\nG02X305000Y210000I0J-130000D01*\nG01X305000Y130000D01*\nG02X175000Y0I-130000J0D01*\nG01X0Y0D01*\nG01X0Y340000D01*\nG37*\n';
 const drill='M48\nMETRIC,LZ,0000.00000\nT01C0.9\n%\nG05\nG90\nT01\nX8.0Y8.0\nM30';
 const archive=(top,d=drill)=>zipSync({'top.gtl':strToU8(headers+top+'M02*'),'pth.drl':strToU8(d)});
 const facts={centerMm:[1.525,1.7],widthMm:3.05,heightMm:3.4},before=archive(original);
 assert.equal(verifyHolderCam(before,archive(region),facts).holeCount,1);
 assert.throws(()=>verifyHolderCam(before,archive(region.replace('G02','G03')),facts),/OUTLINE/);
 assert.throws(()=>verifyHolderCam(before,archive(region,drill.replace('X8.0Y8.0','X1.5Y1.7')),facts),/DRILL_PROGRAM/);
});
test('VDDUSB uses the existing digital rail; the two distinct VBAT nets meet at the qualified diode',()=>{
 const config={holder:'BT1',diode:'D1',usbBulk:'C1',usbBypass:'C2',backupBypass:'C3'};
 const before={components:[{ref:'U1',manufacturerPart:'STM32H563VIT6'}],notes:[],nc:[],openPins:['6','73','23'].map(n=>pin('U1',n)),
   nets:[{name:'+3V3',endpoints:[pin('U1','11')]},{name:'GND',endpoints:[pin('U1','10')]}]};
 const after=structuredClone(before);after.openPins=[pin('U1','23')];after.nets.push({name:'VBAT_CELL',endpoints:[]},{name:'VBAT',endpoints:[]});
 const attach=(net,ref,n)=>after.nets.find(v=>v.name===net).endpoints.push({...pin(ref,n),stubLength:15});
 for(const [ref,a,b] of [['BT1','GND','VBAT_CELL'],['D1','VBAT','VBAT_CELL'],['C1','+3V3','GND'],['C2','+3V3','GND'],['C3','VBAT','GND']]){
   after.components.push({ref,designator:ref});attach(a,ref,'1');attach(b,ref,'2');
 }
 attach('+3V3','U1','73');attach('VBAT','U1','6');
 const delta=usbBackupDelta(before,after,config),native=[{number:'6',name:'VBAT',net:''},{number:'73',name:'VDDUSB',net:''}];
 verifyUsbBackupPins(delta,native);assert.throws(()=>verifyUsbBackupPins(delta,[native[0],{...native[1],name:'VDD'}]));
 for(const change of [a=>a.nets[3].endpoints[0].pin='2',a=>a.nets[2].name='+3V3',a=>a.nets[0].endpoints.shift(),
   a=>a.nets[3].endpoints.pop(),a=>a.openPins.pop()]){
   const bad=structuredClone(after);change(bad);assert.throws(()=>usbBackupDelta(before,bad,config));
 }
 const term=(number,x,y,rotation)=>({number,x,y,rotation}),m=(ref,pins)=>({id:ref,uniqueId:ref,pins});
 const doc={truncated:false,components:[m('U1',[term('6',200,130,180),term('73',250,100,0)]),
   m('BT1',[term('1',0,0,180),term('2',40,0,0)]),m('D1',[term('1',140,0,0),term('2',100,0,180)]),
   m('C3',[term('1',150,110,0),term('2',120,110,180)]),
   m('C1',[term('1',310,70,90),term('2',310,40,270)]),m('C2',[term('1',380,70,90),term('2',380,40,270)])]};
 assert.deepEqual(usbBackupRoutes(delta,doc,[]).map(w=>[w.net,w.anchors.length]),[['VBAT_CELL',2],['VBAT',2],['+3V3',3],['GND',2]]);
 assert.throws(()=>usbBackupRoutes(delta,doc,[[65,-5,65,5]]),/COLLISION/);
 const plate=(x,h)=>({points:[[x,-h],[x,h]],closed:false});
 const symbol={status:'ok',pins:[{number:'1',x:-20},{number:'2',x:20}],symbolPolylines:[plate(-5,3),plate(-2,8),plate(2,3),plate(5,8)]};
 verifyHolderSymbol(symbol);assert.throws(()=>verifyHolderSymbol({...symbol,pins:symbol.pins.map(p=>({...p,x:-p.x}))}));
 const part={ref:'BT1',supplierId:'C5377561',manufacturerPart:'BS08A3B0J001-TP',footprintUuid:'fp',subPartName:'holder.1',properties:{Name:'CR2032'}};
 const pad=(padNumber,x,width,height)=>({padNumber,x:x/.0254,y:0,width:width/.0254,height:height/.0254,shape:'RECT',layerIds:[1]});
 const facts={device:{...part,parameters:{},subPartNames:['holder.1'],footprint:{uuid:'fp'}},symbolGeometry:{geometry:{pins:[]}},footprintGeometry:{geometry:{pads:[pad('1',0,4.5,2.4),pad('2',21.175,3.05,3.4)]}}};
 verifyUsbBackupDevice(config,part,facts);
 const library=facts.footprintGeometry.geometry.pads.map(p=>({...p,rotation:0}));
 const model={uuid:'local',docType:'FOOTPRINT',rows:[{type:'META',body:{source:'fp|lib'}},...library.map(p=>({type:'PAD',
   body:{num:p.padNumber,layerId:1,hole:null,centerX:p.x,centerY:p.y,padOffsetX:.004,padOffsetY:-.005,padAngle:0,
     defaultPad:{padType:'RECT',width:p.width,height:p.height,radius:0},specialPad:[]}}))]};
 const verify=()=>verifyPolarizedFootprint(delta,{...part,libraryUuid:'lib'},{footprint:{uuid:'local'}},new Map([['local',model]]),library);
 assert.equal(verify().lands[0].y,-.005);
 model.rows[2].body.padOffsetX=4;assert.throws(verify,/COPPER_GEOMETRY/);
 facts.footprintGeometry.geometry.pads[1].x*=-1;assert.throws(()=>verifyUsbBackupDevice(config,part,facts));
});
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
