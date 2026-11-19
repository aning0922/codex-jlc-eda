import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';

const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'failed'});};
const key=p=>p.ref+'.'+p.pin;
export function lseDelta(before,after,lse){
  const {crystal,loadIn,loadOut,holder}=lse,refs=new Set([crystal,loadIn,loadOut]);
  check(after&&refs.size===3&&/^Y\d+$/.test(crystal)&&[loadIn,loadOut].every(c=>/^C\d+$/.test(c))&&
    before.components.some(c=>c.ref===holder&&c.supplierId==='C5377561'),'LSE_PARTS_REQUIRED');
  const parts=after.components.filter(c=>refs.has(c.ref));
  check(parts.length===3&&parts.every(c=>c.ref===c.designator)&&equal(before.components,after.components.filter(c=>!refs.has(c.ref)))&&
    equal(before.notes,after.notes),'LSE_EXISTING_CIRCUIT_CHANGED');
  const noConnects=after.nc.filter(p=>p.ref===crystal);
  check(equal(noConnects.map(p=>p.pin).sort(),['2','3'])&&equal(before.nc,after.nc.filter(p=>p.ref!==crystal)),'LSE_UNUSED_LEADS_REQUIRED');
  const remaining=new Set((after.openPins??[]).map(key)),open=before.openPins??[],released=open.filter(p=>!remaining.has(key(p)));
  const owner=released[0]?.ref;
  check(equal(open.filter(p=>remaining.has(key(p))),after.openPins)&&equal(released.map(p=>p.pin).sort(),['8','9'])&&
    released.every(p=>p.ref===owner)&&before.components.find(c=>c.ref===owner)?.manufacturerPart==='STM32H563VIT6','LSE_MCU_PIN_SCOPE');
  const assignments=[{ref:owner,pin:'8',name:'PC14-OSC32_IN',net:'LSE_IN'},{ref:owner,pin:'9',name:'PC15-OSC32_OUT',net:'LSE_OUT'}];
  const expected=new Map(assignments.map(p=>[key(p),p.net]));
  for(const [ref,number,net] of [[crystal,'1','LSE_IN'],[crystal,'4','LSE_OUT'],[loadIn,'1','LSE_IN'],[loadOut,'1','LSE_OUT'],[loadIn,'2','GND'],[loadOut,'2','GND']])expected.set(ref+'.'+number,net);
  const newNetNames=['LSE_IN','LSE_OUT'],oldNames=new Set(before.nets.map(n=>n.name)),seen=new Set();
  check(oldNames.has('GND')&&newNetNames.every(n=>!oldNames.has(n)),'LSE_SOURCE_RAILS');
  const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    const id=key(p);if(!expected.has(id))return true;
    check(!seen.has(id)&&expected.get(id)===n.name,'LSE_ENDPOINT_WRONG_NET');seen.add(id);return false;
  })}));
  check(seen.size===expected.size&&newNetNames.every(name=>stripped.some(n=>n.name===name&&!n.junction&&!n.endpoints.length))&&
    equal(before.nets,stripped.filter(n=>!newNetNames.includes(n.name))),'LSE_EXISTING_NET_CHANGED');
  return {lse,parts,owner,assignments,newNetNames,noConnects,terminals:[]};
}
export function verifyLsePins(d,pins){
  check(d.assignments.every(a=>pins.filter(p=>p.number===a.pin&&p.name===a.name&&p.net==='').length===1),'LSE_NATIVE_MCU_PINS');
}
export function verifyLseDevice(lse,part,{device,footprintGeometry,symbolGeometry}){
  const p=device.parameters;
  check(part.supplierId===device.supplierId&&part.manufacturerPart===device.manufacturerPart&&part.footprintUuid===device.footprint.uuid&&
    device.subPartNames.includes(part.subPartName)&&equal(part.properties,{Name:'={Value}',Value:p.Value}),'LSE_COMPONENT_IDENTITY');
  if(part.ref===lse.crystal){
    check(device.supplierId==='C108687'&&device.manufacturerPart==='SSP-T7-F 32.768kHz 20PPM12.5pF'&&p.Value==='32.768kHz'&&p['Load Capacitance']==='12.5pF','LSE_CRYSTAL_VARIANT');
    const pads=footprintGeometry.geometry.pads,pins=symbolGeometry.geometry.pins;
    const [one,two,three,four]=['1','2','3','4'].map(n=>pads.find(p=>p.padNumber===n));
    check(equal(pins.map(p=>p.pinNumber).sort(),['1','2','3','4'])&&one&&two&&three&&four&&
      one.x===four.x&&two.x===three.x&&one.x<two.x&&one.y===two.y&&three.y===four.y&&one.y<four.y&&
      pads.every(p=>p.shape==='RECT'&&equal(p.layerIds,[1])),'LSE_FOOTPRINT_NUMBERING');
  }else check(p.Value==='18pF'&&['C0G','NP0'].includes(p['Temperature Coefficient'])&&p['Supplier Footprint']==='0402','LSE_LOAD_CAPACITANCE');
}
export function lseRoutes(d,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines),wires=[];
  const pin=(ref,n,rot)=>{const p=pins.get(ref+'.'+n);check(p?.rotation===rot,'LSE_PIN_ORIENTATION');return p;};
  function wire(key,net,anchors,lines,labelAt){reserve(lines,anchors);wires.push({key,net,anchors,lines,labelAt});}
  for(const [number,ref,net,rotation] of [['1',d.lse.loadIn,'LSE_IN',180],['4',d.lse.loadOut,'LSE_OUT',0]]){
    const q=pin(d.lse.crystal,number,rotation),c=pin(ref,'1',90);
    check((c.x-q.x)*(rotation===180?-1:1)>25&&q.y>c.y,'LSE_LOAD_CAP_POSITION');
    wire('crystal-'+number,net,[q,c],[[q.x,q.y,c.x,q.y],[c.x,q.y,c.x,c.y]],[(q.x+c.x)/2,q.y+8]);
  }
  const a=pin(d.lse.loadIn,'2',270),b=pin(d.lse.loadOut,'2',270),y=Math.min(a.y,b.y)-17;
  wire('load-ground','GND',[a,b],[[a.x,a.y,a.x,y],[a.x,y,b.x,y],[b.x,y,b.x,b.y]],[(a.x+b.x)/2,y-12]);
  for(const [n,net,length] of [['8','LSE_IN',12],['9','LSE_OUT',43]]){
    const p=pin(d.owner,n,180),end=p.x-length;
    wire('mcu-'+n,net,[p],[[p.x,p.y,end,p.y]],n==='8'?[end+3,p.y]:[end+12,p.y]);
  }
  return wires;
}
