import {isDeepStrictEqual as equal} from 'node:util';

function check(condition,code){
  if(!condition)throw Object.assign(new Error(code),{code,status:'failed'});
}
const key=p=>p.ref+'.'+p.pin;

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
    caps.every(cap=>['deviceUuid','libraryUuid','subPartName','supplierId','manufacturerPart','footprintUuid','properties'].every(k=>equal(c[k],cap[k]))));
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
export function digitalPowerRoutes(delta,doc,oldLines){
  check(doc.truncated===false,'DIGITAL_POWER_INCOMPLETE_SHEET');
  const pins=new Map(),wires=[],occupied=[...oldLines];
  for(const c of doc.components)for(const p of c.pins){
    const id=c.uniqueId+'.'+p.number;
    check(!pins.has(id)&&[p.x,p.y,p.rotation].every(Number.isFinite),'DIGITAL_POWER_PIN_GEOMETRY');
    pins.set(id,{componentId:c.id,pin:p.number,x:p.x,y:p.y,rotation:p.rotation});
  }
  function reserve(lines,anchors){
    for(const line of lines){
      check(!occupied.some(other=>intersects(line,other)),'DIGITAL_POWER_WIRE_COLLISION');
      for(const p of pins.values())if(on(p.x,p.y,line))
        check(anchors.includes(p)&&((p.x===line[0]&&p.y===line[1])||(p.x===line[2]&&p.y===line[3])),'DIGITAL_POWER_TOUCHES_ANOTHER_PIN');
    }
    occupied.push(...lines);
  }
  for(const pair of delta.pairs){
    const vdd=pins.get(delta.owner+'.'+pair.vdd),vss=pins.get(delta.owner+'.'+pair.vss);
    const positive=pins.get(pair.capacitor+'.1'),negative=pins.get(pair.capacitor+'.2');
    check(vdd&&vss&&positive&&negative&&[0,180].includes(vdd.rotation)&&vss.rotation===vdd.rotation&&
      positive.rotation===(vdd.rotation+180)%360&&negative.rotation===vdd.rotation,'DIGITAL_POWER_CAP_ORIENTATION');
    const side=vdd.rotation===0?1:-1;
    check((positive.x-vdd.x)*side>10&&(negative.x-positive.x)*side>0&&positive.y===negative.y,'DIGITAL_POWER_CAP_POSITION');
    for(const [from,to,net,lane] of [[vdd,positive,delta.supply.name,(vdd.x+positive.x)/2],[vss,negative,'GND',negative.x+side*20]]){
      const lines=from.y===to.y?[[from.x,from.y,to.x,to.y]]:[
        [from.x,from.y,lane,from.y],[lane,from.y,lane,to.y],[lane,to.y,to.x,to.y]];
      const anchors=[from,to];reserve(lines,anchors);
      const labelY=from.y+(from.y>(from===vdd?vss:vdd).y?7:-12);
      wires.push({key:pair.capacitor+'/'+from.pin,net,anchors,lines,labelAt:[(lines[0][0]+lines[0][2])/2,labelY]});
    }
  }
  for(const endpoint of delta.extraGround){
    const p=pins.get(key(endpoint));check(p&&[0,180].includes(p.rotation),'DIGITAL_POWER_GROUND_PIN_GEOMETRY');
    reserve([[p.x,p.y,p.x+(p.rotation===0?1:-1)*endpoint.stubLength,p.y]],[p]);
  }
  return wires;
}
