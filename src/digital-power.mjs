import {isDeepStrictEqual as equal} from 'node:util';

function check(condition,code){
  if(!condition)throw Object.assign(new Error(code),{code,status:'failed'});
}
const key=p=>p.ref+'.'+p.pin;
const modelFields=['deviceUuid','libraryUuid','subPartName','supplierId','manufacturerPart','footprintUuid','properties'];
const sameModel=(a,b)=>modelFields.every(k=>equal(a[k],b[k]));

// Extend only a previously established digital rail. Every changed endpoint is
// either one released MCU pin or one of the two pins of a copy of its decoupler.
export function digitalPowerDelta(before,after,pairs){
  check(after&&pairs?.length,'DIGITAL_POWER_PAIRS_REQUIRED');
  const oldRefs=new Set(before.components.map(c=>c.ref));
  const caps=after.components.filter(c=>!oldRefs.has(c.ref));
  const newRefs=new Set(caps.map(c=>c.ref));
  check(caps.length===pairs.length && newRefs.size===caps.length &&
    new Set(pairs.map(p=>p.capacitor)).size===caps.length && pairs.every(p=>newRefs.has(p.capacitor)) &&
    caps.every(c=>/^C\d+$/.test(c.ref)&&c.ref===c.designator),'DIGITAL_POWER_CAPACITOR_COUNT');
  check(equal(before.components,after.components.filter(c=>oldRefs.has(c.ref))) &&
    equal(before.notes,after.notes)&&equal(before.nc,after.nc),'DIGITAL_POWER_OLD_CIRCUIT_CHANGED');
  const oldOpen=before.openPins??[],newOpen=after.openPins??[];
  const remaining=new Set(newOpen.map(key)),released=oldOpen.filter(p=>!remaining.has(key(p)));
  check(equal(oldOpen.filter(p=>remaining.has(key(p))),newOpen) && released.length>0 &&
    new Set(released.map(p=>p.ref)).size===1,'DIGITAL_POWER_OPEN_PIN_SCOPE');
  const owner=released[0].ref,selected=new Set(released.map(p=>p.pin));
  const vdds=new Set(pairs.map(p=>p.vdd)),vsses=new Set(pairs.map(p=>p.vss));
  check(vdds.size===pairs.length&&vsses.size===pairs.length&&
    pairs.every(p=>selected.has(p.vdd)&&selected.has(p.vss)&&!vdds.has(p.vss)),'DIGITAL_POWER_PAIR_INVALID');
  const supply=before.nets.find(n=>n.name==='+3V3'),ground=before.nets.find(n=>n.name==='GND');
  check(supply&&ground,'DIGITAL_POWER_EXISTING_RAILS_REQUIRED');
  const seed=before.components.find(c=>c.properties?.Value==='100nF'&&
    supply.endpoints.some(p=>p.ref===c.ref&&p.pin==='1')&&ground.endpoints.some(p=>p.ref===c.ref&&p.pin==='2')&&
    caps.every(cap=>sameModel(c,cap)));
  check(seed,'DIGITAL_POWER_MATCH_EXISTING_100NF');
  const assignments=released.map(p=>({...p,name:vdds.has(p.pin)?'VDD':'VSS',net:vdds.has(p.pin)?supply.name:ground.name}));
  const expected=new Map(assignments.map(p=>[key(p),p.net]));
  for(const cap of caps){expected.set(cap.ref+'.1',supply.name);expected.set(cap.ref+'.2',ground.name);}
  const seen=new Set();
  const oldNets=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    const id=key(p);
    if(!expected.has(id))return true;
    check(n.name===expected.get(id)&&!seen.has(id),'DIGITAL_POWER_WRONG_NET');
    seen.add(id);return false;
  })}));
  check(seen.size===expected.size&&equal(oldNets,before.nets),'DIGITAL_POWER_EXISTING_NET_CHANGED');
  const extraGround=after.nets.find(n=>n.name===ground.name).endpoints.filter(p=>p.ref===owner&&selected.has(p.pin)&&!vdds.has(p.pin)&&!vsses.has(p.pin));
  return {caps,owner,pairs,assignments,supply,extraGround,seed:seed.ref};
}
// The H563VI LDO uses two local capacitors on a single VCAP rail.
export function vcapDelta(before,after,vcapPairs){
  const oldRefs=new Set(before.components.map(c=>c.ref));
  const caps=after?.components.filter(c=>!oldRefs.has(c.ref))??[];
  check(caps.length===2 && vcapPairs.length===2 && new Set(vcapPairs.map(p=>p.capacitor)).size===2 &&
    caps.every(c=>/^C\d+$/.test(c.ref)&&c.ref===c.designator&&vcapPairs.some(p=>p.capacitor===c.ref)) &&
    sameModel(caps[0],caps[1]) && /^2\.2[uµμ]F$/.test(caps[0].properties.Value),'VCAP_TWO_MATCHING_2U2_CAPACITORS_REQUIRED');
  check(equal(before.components,after.components.filter(c=>oldRefs.has(c.ref))) &&
    equal(before.notes,after.notes) && equal(before.nc,after.nc),'VCAP_OLD_CIRCUIT_CHANGED');
  const numbers=vcapPairs.map(p=>p.pin).sort();
  check(equal(numbers,['48','98']),'VCAP_H563VI_PINS_REQUIRED');
  const oldOpen=before.openPins??[],remaining=new Set((after.openPins??[]).map(key));
  const released=oldOpen.filter(p=>!remaining.has(key(p))),owner=released[0]?.ref;
  check(equal(oldOpen.filter(p=>remaining.has(key(p))),after.openPins) && equal(released.map(p=>p.pin).sort(),numbers) &&
    released.every(p=>p.ref===owner) && before.components.find(c=>c.ref===owner)?.manufacturerPart==='STM32H563VIT6','VCAP_OPEN_PIN_SCOPE');
  const supply=after.nets.find(n=>n.name==='VCAP'),ground=after.nets.find(n=>n.name==='GND');
  const expected=[...released.map(key),...caps.map(c=>c.ref+'.1')].sort();
  check(!before.nets.some(n=>n.name==='VCAP') && supply && !supply.junction && equal(supply.endpoints.map(key).sort(),expected),'VCAP_COMMON_RAIL_REQUIRED');
  check(ground&&!ground.junction,'VCAP_DIGITAL_GROUND_REQUIRED');
  const extraGround=ground.endpoints.filter(p=>caps.some(c=>c.ref===p.ref));
  check(equal(extraGround.map(key).sort(),caps.map(c=>c.ref+'.2').sort()),'VCAP_DIGITAL_GROUND_REQUIRED');
  const prior=after.nets.filter(n=>n!==supply).map(n=>n===ground?{...n,endpoints:n.endpoints.filter(p=>!extraGround.includes(p))}:n);
  check(equal(before.nets,prior),'VCAP_EXISTING_NET_CHANGED');
  return {caps,owner,vcapPairs,supply,extraGround,assignments:released.map(p=>({...p,name:'VCAP',net:'VCAP'}))};
}
export function verifyVcapPins(delta,pins){
  const native=pins.filter(p=>p.name==='VCAP');
  check(equal(native.map(p=>p.number).sort(),delta.assignments.map(p=>p.pin).sort()) &&
    native.every(p=>p.net===''),'VCAP_NATIVE_PINS_OR_NET');
}
export function verifyVcapCapacitor(device){
  const p=device.parameters;
  check(device.subPartNames.length===1 && /^2\.2[uµμ]F$/.test(p.Value) && p['Temperature Coefficient']==='X7R' &&
    p['Supplier Footprint']==='0603' && /^\d+(?:\.\d+)?V$/.test(p['Voltage Rating']) && parseFloat(p['Voltage Rating'])>=10 &&
    /^±(5|10|20)%$/.test(p.Tolerance),'VCAP_CAPACITOR_SPECIFICATION');
}
export function verifyDigitalPins(delta,pins){
  const domain=pins.filter(p=>['VDD','VSS'].includes(p.name));
  check(domain.some(p=>p.name==='VDD'&&p.net===delta.supply.name),'DIGITAL_POWER_FIRST_VDD_REQUIRED');
  for(const p of delta.assignments){
    const found=domain.filter(pin=>pin.number===p.pin);
    check(found.length===1&&found[0].name===p.name&&found[0].net==='','DIGITAL_POWER_PIN_NAME_OR_NET');
  }
  for(const p of domain){
    const change=delta.assignments.find(x=>x.pin===p.number);
    check((change?.net??p.net)===(p.name==='VDD'?delta.supply.name:'GND'),'DIGITAL_POWER_DOMAIN_INCOMPLETE');
  }
}
const between=(v,a,b)=>Math.min(a,b)<=v&&v<=Math.max(a,b);
const on=(x,y,[a,b,c,d])=>(a===c&&x===a&&between(y,b,d))||(b===d&&y===b&&between(x,a,c));
function intersects(l,m){
  const [a,b,c,d]=l,[x,y,u,v]=m;
  return on(a,b,m)||on(c,d,m)||on(x,y,l)||on(u,v,l)||
    (a===c&&y===v&&between(a,x,u)&&between(y,b,d))||
    (b===d&&x===u&&between(x,a,c)&&between(b,y,v));
}
export function powerWireSpace(doc,oldLines){
  check(doc.truncated===false,'DIGITAL_POWER_INCOMPLETE_SHEET');
  const pins=new Map(),occupied=[...oldLines];
  for(const c of doc.components)for(const p of c.pins){
    const id=c.uniqueId+'.'+p.number;
    check(!pins.has(id)&&[p.x,p.y,p.rotation].every(Number.isFinite),'DIGITAL_POWER_PIN_GEOMETRY');
    pins.set(id,{componentId:c.id,pin:p.number,x:Math.round(p.x*1e6)/1e6,y:Math.round(p.y*1e6)/1e6,rotation:p.rotation});
  }
  function reserve(lines,anchors){
    for(const line of lines){
      check(!occupied.some(other=>intersects(line,other)),'DIGITAL_POWER_WIRE_COLLISION');
      for(const p of pins.values())if(on(p.x,p.y,line))
        check(anchors.includes(p)&&((p.x===line[0]&&p.y===line[1])||(p.x===line[2]&&p.y===line[3])),'DIGITAL_POWER_TOUCHES_ANOTHER_PIN');
    }
    occupied.push(...lines);
  }
  return {pins,reserve};
}
export function digitalPowerRoutes(delta,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines),wires=[];
  for(const pair of delta.pairs??delta.vcapPairs){
    const vdd=pins.get(delta.owner+'.'+(pair.vdd??pair.pin)),vss=pair.vss&&pins.get(delta.owner+'.'+pair.vss);
    const positive=pins.get(pair.capacitor+'.1'),negative=pins.get(pair.capacitor+'.2');
    check(vdd&&positive&&negative&&[0,180].includes(vdd.rotation)&&(!pair.vss||vss?.rotation===vdd.rotation)&&
      positive.rotation===(vdd.rotation+180)%360&&negative.rotation===vdd.rotation,'DIGITAL_POWER_CAP_ORIENTATION');
    const side=vdd.rotation===0?1:-1;
    check((positive.x-vdd.x)*side>10&&(negative.x-positive.x)*side>0&&positive.y===negative.y,'DIGITAL_POWER_CAP_POSITION');
    const branches=[[vdd,positive,delta.supply.name,(vdd.x+positive.x)/2]];
    if(vss)branches.push([vss,negative,'GND',negative.x+side*20]);
    for(const [from,to,net,lane] of branches){
      const lines=from.y===to.y?[[from.x,from.y,to.x,to.y]]:[
        [from.x,from.y,lane,from.y],[lane,from.y,lane,to.y],[lane,to.y,to.x,to.y]];
      const anchors=[from,to];reserve(lines,anchors);
      const above=vss?from.y>(from===vdd?vss:vdd).y:to.y>=from.y;
      const labelY=from.y+(above?7:-12);
      wires.push({key:pair.capacitor+'/'+from.pin,net,anchors,lines,labelAt:[(lines[0][0]+lines[0][2])/2,labelY]});
    }
  }
  for(const endpoint of delta.extraGround){
    const p=pins.get(key(endpoint));check(p&&[0,180].includes(p.rotation),'DIGITAL_POWER_GROUND_PIN_GEOMETRY');
    reserve([[p.x,p.y,p.x+(p.rotation===0?1:-1)*endpoint.stubLength,p.y]],[p]);
  }
  return wires;
}

// Two bulk capacitors on an established digital rail release no MCU pins.
export function bulkDecouplingDelta(before,after,refs){
  const caps=after.components.filter(c=>refs.includes(c.ref));
  check(refs.length===2&&new Set(refs).size===2&&caps.length===2&&refs.every(r=>caps.some(c=>c.ref===r))&&
    caps.every(c=>/^C\d+$/.test(c.ref)&&c.ref===c.designator)&&sameModel(caps[0],caps[1])&&
    /^4\.7[uµμ]F$/.test(caps[0].properties.Value),'BULK_TWO_4U7_CAPACITORS_REQUIRED');
  check(!before.components.some(c=>refs.includes(c.ref))&&equal(before.components,after.components.filter(c=>!refs.includes(c.ref)))&&
    equal(before.notes,after.notes)&&equal(before.nc,after.nc)&&equal(before.openPins,after.openPins),'BULK_OLD_CIRCUIT_CHANGED');
  const mcu=before.components.filter(c=>c.manufacturerPart==='STM32H563VIT6');
  check(mcu.length===1,'BULK_H563VI_REQUIRED');
  const supply=before.nets.find(n=>n.name==='+3V3'),ground=before.nets.find(n=>n.name==='GND');
  const has=(net,ref,pin)=>net?.endpoints.some(e=>e.ref===ref&&e.pin===pin);
  check(['11','28','50','75','100'].every(n=>has(supply,mcu[0].ref,n))&&
    ['10','27','49','74','99'].every(n=>has(ground,mcu[0].ref,n))&&
    before.components.filter(c=>c.properties?.Value==='100nF'&&has(supply,c.ref,'1')&&has(ground,c.ref,'2')).length>=5,'BULK_DIGITAL_SUPPLY_REQUIRED');
  const expected=new Map(caps.flatMap(c=>[[c.ref+'.1','+3V3'],[c.ref+'.2','GND']]));
  const prior=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    if(!refs.includes(p.ref))return true;
    check(expected.get(key(p))===n.name,'BULK_CAPACITOR_PIN_NET');expected.delete(key(p));return false;
  })}));
  check(!expected.size&&equal(before.nets,prior),'BULK_EXISTING_NET_CHANGED');
  return {bulkDecoupling:refs,caps,owner:mcu[0].ref,supply,assignments:[],newNetNames:[],terminals:[]};
}
export function verifyBulkCapacitor(device,spec){
  const p=device.parameters,rating=p['Voltage Rating']??p['Voltage Rated'];
  check(device.subPartNames.length===1&&spec.subPartName===device.subPartNames[0]&&p['Supplier Footprint']==='0805'&&
    p['Temperature Coefficient']==='X7R'&&/^4\.7[uµμ]F$/.test(p.Value)&&/^\d+(?:\.\d+)?V$/.test(rating)&&parseFloat(rating)>3.3,'BULK_CAPACITOR_SPECIFICATION');
}
export function bulkDecouplingRoutes(d,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines);
  return [['1','+3V3',90,1],['2','GND',270,-1]].map(([number,net,rotation,sign])=>{
    const anchors=d.bulkDecoupling.map(ref=>pins.get(ref+'.'+number));
    check(anchors.every(p=>p?.rotation===rotation),'BULK_CAP_ORIENTATION');
    const [a,b]=anchors;
    check(a.y===b.y&&Math.abs(b.x-a.x)>=40,'BULK_CAP_ALIGNMENT');
    const y=a.y+sign*12,lines=[[a.x,a.y,a.x,y],[a.x,y,b.x,y],[b.x,y,b.x,b.y]];
    reserve(lines,anchors);
    return {key:'bulk-'+number,net,anchors,lines,labelAt:[(a.x+b.x)/2,y+5]};
  });
}
