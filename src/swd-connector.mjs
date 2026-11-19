import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'failed'});};
const mm=.0254,near=(v,n,t=.00005)=>Number.isFinite(v)&&Math.abs(v-n)<=t;
export const swdHeaderNets=['+3V3','SWDIO','SWCLK','GND','NRST'];

export function swdDelta(before,after,swdConnector){
 const {header,resetSwitch,bootSwitch}=swdConnector,part=after?.components.find(c=>c.ref===header);
 check(/^J\d+$/.test(header)&&part?.designator===header&&equal(before.components,after.components.filter(c=>c!==part))&&
   !before.components.some(c=>c.ref===header)&&equal(after.nc,before.nc)&&equal(after.notes,before.notes),'SWD_EXISTING_COMPONENTS');
 const mcu=before.components.filter(c=>c.manufacturerPart==='STM32H563VIT6');check(mcu.length===1,'SWD_MCU_IDENTITY');const owner=mcu[0].ref;
 const oldNet=(net,ref,pin)=>before.nets.find(n=>n.name===net)?.endpoints.some(p=>p.ref===ref&&p.pin===pin);
 check(oldNet('NRST',owner,'14')&&oldNet('NRST',resetSwitch,'1')&&oldNet('BOOT0',bootSwitch,'1')&&oldNet('GND',resetSwitch,'2')&&oldNet('+3V3',bootSwitch,'2'),'SWD_SOURCE_RESET_RAILS');
 const released=p=>p.ref===owner&&['72','76'].includes(p.pin);
 check(before.openPins.filter(released).length===2&&equal(after.openPins,before.openPins.filter(p=>!released(p))),'SWD_OPEN_PIN_SCOPE');
 const assignments=[{ref:owner,pin:'72',name:'PA13',net:'SWDIO'},{ref:owner,pin:'76',name:'PA14',net:'SWCLK'}];
 const expected=new Map(assignments.map(p=>[p.ref+'.'+p.pin,p.net]));
 swdHeaderNets.forEach((net,i)=>expected.set(header+'.'+(i+1),net));const newNetNames=['SWDIO','SWCLK'],seen=new Set();
 check(!before.nets.some(n=>newNetNames.includes(n.name)),'SWD_EXISTING_DEBUG_NET');
 const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
   const id=p.ref+'.'+p.pin;if(!expected.has(id))return true;check(!seen.has(id)&&expected.get(id)===n.name,'SWD_PINOUT_MISMATCH');seen.add(id);return false;
 })}));
 check(seen.size===7&&newNetNames.every(name=>stripped.filter(n=>n.name===name&&!n.junction&&!n.endpoints.length).length===1)&&
   equal(before.nets,stripped.filter(n=>!newNetNames.includes(n.name))),'SWD_OLD_NET_CHANGED');
 return {swdConnector,parts:[part],owner,assignments,newNetNames,terminals:[]};
}
export function verifySwdDevice(part,{device,footprintGeometry,symbolGeometry}){
 const p=device.parameters,pads=footprintGeometry.geometry.pads.slice().sort((a,b)=>+a.padNumber-+b.padNumber);
 check(device.supplierId===part.supplierId&&device.supplierId==='C42431835'&&device.manufacturerPart==='PH2.54-1X5P-H25'&&part.manufacturerPart===device.manufacturerPart&&
   part.footprintUuid===device.footprint.uuid&&device.subPartNames.includes(part.subPartName)&&equal(part.properties,{Name:'SWD'})&&
   p['Pin Structure']==='1x5P'&&p.Pitch==='2.54mm'&&p['Mounting Type']==='直插','SWD_HEADER_MODEL');
 check(equal(pads.map(v=>v.padNumber),['1','2','3','4','5'])&&pads.every((v,i)=>v.shape===(i?'ELLIPSE':'RECT')&&
   v.plated&&v.layerIds.includes(1)&&v.layerIds.includes(2)&&v.holeType==='ROUND'&&near(v.holeDiameter*mm,1.02)&&
   near(v.width*mm,1.60)&&near(v.height*mm,1.60)&&near((v.x-pads[0].x)*mm,i*2.54)&&near(v.y,pads[0].y)),'SWD_HEADER_DRILL_GEOMETRY');
 check(equal(symbolGeometry.geometry.pins.map(v=>v.pinNumber).sort(),['1','2','3','4','5']),'SWD_SYMBOL_NUMBERS');
}
export function swdRoutes(d,doc,oldLines){
 const {pins,reserve}=powerWireSpace(doc,oldLines),wires=[];
 function stub(ref,n,net,rot,length,labelX){
   const p=pins.get(ref+'.'+n);check(p?.rotation===rot,'SWD_PIN_DIRECTION');
   const lines=[[p.x,p.y,p.x+length,p.y]];reserve(lines,[p]);wires.push({key:ref+'-'+n,net,anchors:[p],lines,labelAt:[p.x+labelX,p.y]});
 }
 swdHeaderNets.forEach((net,i)=>stub(d.swdConnector.header,String(i+1),net,180,-54,-32));
 stub(d.owner,'72','SWDIO',0,20,11);
 // Clear the existing VDD label and the vertical leg to the decoupling capacitor beside PA14.
 const clk=pins.get(d.owner+'.76');check(clk?.rotation===0,'SWD_PIN_DIRECTION');
 const {x,y}=clk,lines=[[x,y,x+4,y],[x+4,y,x+4,y+31],[x+4,y+31,x+43,y+31]];
 reserve(lines,[clk]);wires.push({key:d.owner+'-76',net:'SWCLK',anchors:[clk],lines,labelAt:[x+23,y+31]});
 return wires;
}
export function swdBoardHeader(part,spec,models){
 const m=models.get(part.footprint.uuid),rows=m?.rows.filter(r=>r.type==='PAD').sort((a,b)=>+a.body.num-+b.body.num);
 check(m?.docType==='FOOTPRINT'&&m.rows.filter(r=>r.type==='META'&&r.body.source===spec.footprintUuid+'|'+spec.libraryUuid).length===1&&rows?.length===5&&
   part.layer===1&&part.rotation===0&&part.pins.length===5,'SWD_BOARD_MODEL_BINDING');
 return rows.map(({id,body:p},i)=>{
   const pin=part.pins.find(v=>v.number===String(i+1)&&v.id===part.id+id);
   check(p.num===String(i+1)&&pin?.net===swdHeaderNets[i]&&p.plated===true&&p.hole?.holeType==='ROUND'&&near(p.hole.width*mm,1.02)&&near(p.hole.height*mm,1.02)&&
     p.defaultPad.padType===(i?'ELLIPSE':'RECT')&&near(p.defaultPad.width*mm,1.60)&&near(p.defaultPad.height*mm,1.60)&&
     near((p.centerX-rows[0].body.centerX)*mm,i*2.54)&&near(p.centerY,rows[0].body.centerY)&&near(pin.x,part.x+p.centerX,.051)&&near(pin.y,part.y+p.centerY,.051),'SWD_STORED_PAD_MISMATCH');
   return {number:p.num,id:pin.id,net:pin.net,xMm:(part.x+p.centerX)*mm,yMm:(part.y+p.centerY)*mm,diameterMm:p.hole.width*mm,shape:p.defaultPad.padType};
 });
}
