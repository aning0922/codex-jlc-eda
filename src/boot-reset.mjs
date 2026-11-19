import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';
const check=(v,code)=>{if(!v)throw Object.assign(Error(code),{code,status:'failed'});};
const endpoint=p=>p.ref+'.'+p.pin;

export function bootResetDelta(before,after,bootReset){
 const {crystal,pullDown,filter,resetSwitch,bootSwitch}=bootReset,refs=[pullDown,filter,resetSwitch,bootSwitch];
 check(/^R\d+$/.test(pullDown)&&/^C\d+$/.test(filter)&&[resetSwitch,bootSwitch].every(x=>/^SW\d+$/.test(x))&&new Set(refs).size===4&&
   before.components.some(c=>c.ref===crystal&&c.supplierId==='C108687'),'BOOT_RESET_PARTS');
 const parts=after.components.filter(c=>refs.includes(c.ref));
 check(parts.length===4&&new Set(parts.map(p=>p.ref)).size===4&&parts.every(c=>c.ref===c.designator)&&
   equal(before.components,after.components.filter(c=>!refs.includes(c.ref)))&&equal(before.notes,after.notes)&&equal(before.nc,after.nc),'BOOT_RESET_EXISTING_CIRCUIT');
 const remaining=new Set(after.openPins.map(endpoint)),released=before.openPins.filter(p=>!remaining.has(endpoint(p))),owner=released[0]?.ref;
 check(equal(before.openPins.filter(p=>remaining.has(endpoint(p))),after.openPins)&&equal(released.map(p=>p.pin).sort(),['14','94'])&&
   released.every(p=>p.ref===owner)&&before.components.find(c=>c.ref===owner)?.manufacturerPart==='STM32H563VIT6','BOOT_RESET_MCU_PINS');
 const assignments=[{ref:owner,pin:'14',name:'NRST',net:'NRST'},{ref:owner,pin:'94',name:'BOOT0',net:'BOOT0'}];
 const extra=new Map([[owner+'.14','NRST'],[owner+'.94','BOOT0'],[filter+'.1','NRST'],[filter+'.2','GND'],
   [pullDown+'.1','BOOT0'],[pullDown+'.2','GND'],[resetSwitch+'.1','NRST'],[resetSwitch+'.2','GND'],[bootSwitch+'.1','BOOT0'],[bootSwitch+'.2','+3V3']]);
 const newNetNames=['BOOT0','NRST'],seen=new Set(),old=new Set(before.nets.map(n=>n.name));
 check(old.has('GND')&&old.has('+3V3')&&newNetNames.every(n=>!old.has(n)),'BOOT_RESET_SOURCE_RAILS');
 const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
   const k=endpoint(p);if(!extra.has(k))return true;check(extra.get(k)===n.name&&!seen.has(k),'BOOT_RESET_NET_ASSIGNMENT');seen.add(k);return false;
 })}));
 check(seen.size===extra.size&&newNetNames.every(name=>stripped.filter(n=>n.name===name&&!n.endpoints.length&&!n.junction).length===1)&&
   equal(before.nets,stripped.filter(n=>!newNetNames.includes(n.name))),'BOOT_RESET_EXISTING_NET');
 return {bootReset,parts,owner,assignments,newNetNames,terminals:[]};
}

export function verifyBootResetDevice(config,part,{device,footprintGeometry,symbolGeometry}){
 const p=device.parameters,sw=[config.bootSwitch,config.resetSwitch].includes(part.ref);
 const properties=sw?{Name:part.ref===config.bootSwitch?'BOOT':'RESET'}:{Name:'={Value}',Value:p.Value};
 check(device.supplierId===part.supplierId&&device.manufacturerPart===part.manufacturerPart&&device.subPartNames.includes(part.subPartName)&&
   device.footprint.uuid===part.footprintUuid&&equal(part.properties,properties),'BOOT_RESET_PART_IDENTITY');
 if(sw){
   const pads=footprintGeometry.geometry.pads,pins=symbolGeometry.geometry.pins;
   check(device.supplierId==='C36498961'&&device.manufacturerPart==='HX 3x4x2-2P-2.5N'&&p.Circuit==='单刀单掷'&&
     [pads.map(p=>p.padNumber),pins.map(p=>p.pinNumber)].every(numbers=>equal(numbers.sort(),['1','2']))&&
     pads.every(p=>p.shape==='RECT'&&equal(p.layerIds,[1])),'BOOT_RESET_SWITCH_MODEL');
 }else if(part.ref===config.pullDown)check(device.supplierId==='C25744'&&p.Value==='10kΩ'&&p['Supplier Footprint']==='0402','BOOT_PULLDOWN_VALUE');
 else check(device.supplierId==='C1525'&&p.Value==='100nF'&&p['Temperature Coefficient']==='X7R'&&p['Supplier Footprint']==='0402','RESET_FILTER_VALUE');
}

export function bootPinLabel(number,p){return number==='14'?[p.x-24,p.y]:[p.x+18,p.y-7];}
export function bootResetRoutes(d,doc,oldLines){
 const {pins,reserve}=powerWireSpace(doc,oldLines),wires=[],cfg=d.bootReset;
 const pin=(ref,n,rotation)=>{const p=pins.get(ref+'.'+n);check(p?.rotation===rotation,'BOOT_RESET_PIN_ORIENTATION');return p;};
 const add=(key,net,anchors,lines,labelAt)=>{reserve(lines,anchors);wires.push({key,net,anchors,lines,labelAt});};
 function bridge(key,net,refA,refB,n){
   const top=n==='1',rot=top?90:270,a=pin(refA,n,rot),b=pin(refB,n,rot);
   check(b.x-a.x>=60,'BOOT_RESET_SCHEMATIC_SPACING');
   const y=top?Math.max(a.y,b.y)+12:Math.min(a.y,b.y)-12;
   add(key,net,[a,b],[[a.x,a.y,a.x,y],[a.x,y,b.x,y],[b.x,y,b.x,b.y]],[(a.x+b.x)/2,y+(top?4:-10)]);
 }
 bridge('reset','NRST',cfg.resetSwitch,cfg.filter,'1');
 bridge('reset-return','GND',cfg.resetSwitch,cfg.filter,'2');
 bridge('boot','BOOT0',cfg.pullDown,cfg.bootSwitch,'1');
 for(const [ref,net] of [[cfg.pullDown,'GND'],[cfg.bootSwitch,'+3V3']]){
   const p=pin(ref,'2',270),y=p.y-17;add('return-'+ref,net,[p],[[p.x,p.y,p.x,y]],[p.x,y-10]);
 }
 for(const [n,net,rotation,dx] of [['14','NRST',180,-34],['94','BOOT0',0,32]]){
   const p=pin(d.owner,n,rotation),label=bootPinLabel(n,p);
   add('mcu-'+n,net,[p],[[p.x,p.y,p.x+dx,p.y]],label);
 }
 return wires;
}
