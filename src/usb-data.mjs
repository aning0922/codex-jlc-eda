import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';

const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'failed'});};
const sorted=values=>[...values].sort();
const portNets={
  jack:{A1B12:'GND',B1A12:'GND',A4B9:'USB_VBUS',B4A9:'USB_VBUS',A5:'USB_CC1',B5:'USB_CC2',A6:'DP_CONN',B6:'DP_CONN',A7:'DM_CONN',B7:'DM_CONN','13':'GND',A8:'',B8:''},
  esd:{1:'DP_CONN',6:'USB_DP',3:'DM_CONN',4:'USB_DM',2:'GND',5:'USB_VBUS'},
  cc1:{1:'USB_CC1',2:'GND'},cc2:{1:'USB_CC2',2:'GND'},senseTop:{1:'USB_VBUS',2:'VBUS_DET'},
  senseBottom:{1:'VBUS_DET',2:'GND'},bulk:{1:'USB_VBUS',2:'GND'}
};
const roles=Object.keys(portNets);
const partCodes={jack:['C6332278','MC-121-L119'],esd:['C7519','USBLC6-2SC6'],cc1:['C25905','0402WGF5101TCE','5.1kΩ'],
  cc2:['C25905','0402WGF5101TCE','5.1kΩ'],senseTop:['C25779','0402WGF3302TCE','33kΩ'],senseBottom:['C25792','0402WGF4702TCE','47kΩ'],bulk:['C28234','CL21B225KOFNNNE','2.2uF']};
const newNetNames=['USB_VBUS','USB_CC1','USB_CC2','DP_CONN','DM_CONN','USB_DP','USB_DM','VBUS_DET'];
const roleFor=(config,ref)=>roles.find(role=>config[role]===ref);
export function usbPortNumbers(config,ref,physical=false){
  const role=roleFor(config,ref);check(role,'USB_DATA_UNKNOWN_PART');
  const numbers=Object.keys(portNets[role]);if(physical&&role==='jack')numbers.push('13','13','13');
  return sorted(numbers);
}

export function usbDataDelta(before,after,usbData){
  const refs=roles.map(k=>usbData[k]),parts=refs.map(ref=>after.components.find(c=>c.ref===ref));
  check(new Set(refs).size===refs.length&&parts.every((p,i)=>p?.designator===refs[i])&&
    !before.components.some(c=>refs.includes(c.ref))&&equal(before.components,after.components.filter(c=>!refs.includes(c.ref)))&&equal(before.notes,after.notes),'USB_DATA_COMPONENT_SCOPE');
  const mcus=before.components.filter(c=>c.manufacturerPart==='STM32H563VIT6');check(mcus.length===1,'USB_DATA_MCU');const owner=mcus[0].ref;
  const assignments=[{ref:owner,pin:'70',name:'PA11',net:'USB_DM'},{ref:owner,pin:'71',name:'PA12',net:'USB_DP'},{ref:owner,pin:'60',name:'PD13',net:'VBUS_DET'}];
  const released=p=>assignments.some(a=>a.ref===p.ref&&a.pin===p.pin);
  check(before.openPins.filter(released).length===3&&equal(after.openPins,before.openPins.filter(p=>!released(p))),'USB_DATA_MCU_PINS');
  check(before.nets.some(n=>n.name==='+3V3'&&n.endpoints.some(p=>p.ref===owner&&p.pin==='73'))&&
    before.nets.some(n=>n.name==='GND')&&!before.nets.some(n=>newNetNames.includes(n.name)),'USB_DATA_SOURCE_RAILS');
  const expected=new Map(assignments.map(p=>[p.ref+'.'+p.pin,p.net]));
  for(const role of roles)for(const [pin,net] of Object.entries(portNets[role]))if(net)expected.set(usbData[role]+'.'+pin,net);
  const noConnects=after.nc.filter(p=>p.ref===usbData.jack);
  check(equal(sorted(noConnects.map(p=>p.pin)),['A8','B8'])&&equal(after.nc.filter(p=>p.ref!==usbData.jack),before.nc),'USB_DATA_SBU_NC');
  const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    const id=p.ref+'.'+p.pin;if(!expected.has(id))return true;check(n.name===expected.get(id),'USB_DATA_PIN_NET');expected.delete(id);return false;
  })}));
  check(!expected.size&&newNetNames.every(name=>stripped.filter(n=>n.name===name&&!n.junction&&!n.endpoints.length).length===1)&&
    equal(before.nets,stripped.filter(n=>!newNetNames.includes(n.name))),'USB_DATA_OLD_NET_CHANGED');
  return {usbData,owner,parts,assignments,newNetNames,noConnects,terminals:[]};
}

export function verifyUsbDataDevice(config,part,{device,footprintGeometry,symbolGeometry}){
  const role=roleFor(config,part.ref),[code,mpn,value]=partCodes[role],p=device.parameters;
  check(device.supplierId===code&&part.supplierId===code&&device.manufacturerPart===mpn&&part.manufacturerPart===mpn&&
    part.footprintUuid===device.footprint.uuid&&device.subPartNames.includes(part.subPartName),'USB_DATA_PART_IDENTITY');
  if(value)check(p.Value===value&&part.properties.Value===value&&(role==='bulk'?
    p['Voltage Rated']==='16V'&&p['Temperature Coefficient']==='X7R':p.Tolerance==='±1%'),'USB_DATA_PASSIVE_VALUE');
  if(role!=='jack')return;
  const contacts={A1B12:'GND',B1A12:'GND',A4B9:'VBUS',B4A9:'VBUS',A5:'CC1',B5:'CC2',A6:'DP1',B6:'DP2',A7:'DN1',B7:'DN2',A8:'SBU1',B8:'SBU2',13:'EH'};
  check(equal(Object.fromEntries(symbolGeometry.geometry.pins.map(p=>[p.pinNumber,p.pinName])),contacts),'USB_DATA_HANBO_PINOUT');
  const pads=footprintGeometry.geometry.pads,slots=pads.filter(p=>p.padNumber==='13'),mm=v=>v*.0254,near=(v,n)=>Math.abs(v-n)<.001;
  const row=pads.filter(p=>p.padNumber!=='13').sort((a,b)=>a.x-b.x);
  check(equal(row.map(p=>p.padNumber),['A1B12','A4B9','B8','A5','B7','A6','A7','B6','A8','B5','B4A9','B1A12'])&&
    row.every((p,i)=>p.shape==='RECT'&&equal(p.layerIds,[1])&&near(p.y,row[0].y)&&near(mm(p.height),1.15)&&
      near(mm(p.width),i<2||i>9?.60:.30)&&near(mm(p.x),[-3.2,-2.4,-1.75,-1.25,-.75,-.25,.25,.75,1.25,1.75,2.4,3.2][i])),'USB_DATA_HANBO_CONTACT_LANDS');
  const ys=[...new Set(slots.map(p=>p.y))].sort((a,b)=>a-b);
  check(slots.length===4&&new Set(slots.map(p=>[p.x,p.y].join(','))).size===4&&ys.length===2&&near(mm(ys[1]-ys[0]),4.18)&&
    slots.every(p=>p.plated&&p.holeType==='SLOT'&&p.layerIds.includes(1)&&p.layerIds.includes(2)&&near(mm(Math.abs(p.x)),4.32)&&
    near(mm(p.slotSize.width),.6)&&near(mm(p.slotSize.length),p.y===ys[1]?1.70:1.40)),'USB_DATA_SHELL_SLOTS');
}

export function usbDataRoutes(d,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines),wires=[];
  function wire(key,net,anchors,lines,labelAt){reserve(lines,anchors);wires.push({key,net,anchors,lines,labelAt});}
  function stub(ref,pin,net,length){
    const p=pins.get(ref+'.'+pin);check(p&&[0,180].includes(p.rotation),'USB_DATA_PIN_DIRECTION');
    const dx=p.rotation===180?-length:length;wire(ref+'-'+pin,net,[p],[[p.x,p.y,p.x+dx,p.y]],[p.x+Math.round(dx*.57),p.y]);
  }
  const cfg=d.usbData;
  for(const role of roles)for(const [pin,net] of Object.entries(portNets[role])){
    if(!net||role==='jack'&&pin==='13'||role==='senseTop'&&pin==='2'||role==='senseBottom'&&pin==='1')continue;
    const length=role==='jack'?48:role==='esd'?(Number(pin)>=4?26:33):28;
    stub(cfg[role],pin,net,length);
  }
  const shell=pins.get(cfg.jack+'.13');
  check(shell.rotation===0,'USB_DATA_PIN_DIRECTION');
  const {x,y}=shell;
  wire(cfg.jack+'-13','GND',[shell],[[x,y,x+2,y],[x+2,y,x+2,y-54],[x+2,y-54,x+27,y-54]],[x+17,y-54]);
  const a=pins.get(cfg.senseTop+'.2'),b=pins.get(cfg.senseBottom+'.1');
  check(a.rotation===0&&b.rotation===180&&a.y===b.y&&b.x-a.x>=40,'USB_DATA_SENSE_DIVIDER_POSE');
  wire('sense-divider','VBUS_DET',[a,b],[[a.x,a.y,b.x,b.y]],[(a.x+b.x)/2,a.y]);
  for(const p of d.assignments)stub(p.ref,p.pin,p.net,p.pin==='71'?21:40);
  return wires;
}
