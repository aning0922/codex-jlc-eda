import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';

const analogPins={'19':['VSSA','GNDA'],'20':['VREF-','GNDA'],'21':['VREF+','+3V3A'],'22':['VDDA','+3V3A']};
const key=p=>p.ref+'.'+p.pin;
function check(value,code){
  if(!value)throw Object.assign(new Error(code),{code,status:'failed'});
}
export function analogPowerDelta(before,after,analogSupply){
  const {bead,groundLink,vddaCaps,vrefCaps}=analogSupply;
  const capRefs=[...vddaCaps,...vrefCaps],refs=[bead,groundLink,...capRefs],set=new Set(refs);
  check(after&&set.size===7&&/^FB\d+$/.test(bead)&&/^R\d+$/.test(groundLink)&&
    capRefs.every(c=>/^C\d+$/.test(c)),'ANALOG_PASSIVES_REQUIRED');
  const parts=after.components.filter(c=>set.has(c.ref));
  check(parts.length===7&&parts.every(c=>c.designator===c.ref)&&
    equal(before.components,after.components.filter(c=>!set.has(c.ref)))&&
    equal(before.nc,after.nc)&&equal(before.notes,after.notes),'ANALOG_OLD_CIRCUIT_CHANGED');
  const remaining=new Set((after.openPins??[]).map(key)),oldOpen=before.openPins??[];
  const released=oldOpen.filter(p=>!remaining.has(key(p))),owner=released[0]?.ref;
  check(equal(oldOpen.filter(p=>remaining.has(key(p))),after.openPins)&&
    equal(released.map(p=>p.pin).sort(),Object.keys(analogPins))&&released.every(p=>p.ref===owner)&&
    before.components.find(c=>c.ref===owner)?.manufacturerPart==='STM32H563VIT6','ANALOG_H563VI_OPEN_PIN_SCOPE');
  const assignments=released.map(p=>({...p,name:analogPins[p.pin][0],net:analogPins[p.pin][1]}));
  const expected=new Map(assignments.map(p=>[key(p),p.net]));
  expected.set(bead+'.1','+3V3');expected.set(bead+'.2','+3V3A');
  expected.set(groundLink+'.1','GND');expected.set(groundLink+'.2','GNDA');
  for(const ref of capRefs){expected.set(ref+'.1','+3V3A');expected.set(ref+'.2','GNDA');}
  const oldNets=new Map(before.nets.map(n=>[n.name,n]));
  check(['+3V3','GND','GNDA'].every(n=>oldNets.has(n))&&!oldNets.has('+3V3A'),'ANALOG_SOURCE_RAILS_REQUIRED');
  const digitalGnd=new Set(oldNets.get('GND').endpoints.map(p=>p.ref));
  check(!oldNets.get('GNDA').endpoints.some(p=>digitalGnd.has(p.ref)&&/^(R|L|FB|NT)\d+$/.test(p.ref)),'ANALOG_GROUND_LINK_ALREADY_PRESENT');
  const supply=after.nets.find(n=>n.name==='+3V3A'),terminals=[],seen=new Set();
  check(supply&&!supply.junction,'ANALOG_FILTERED_RAIL_REQUIRED');
  const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    const id=key(p);if(!expected.has(id))return true;
    check(!seen.has(id)&&expected.get(id)===n.name,'ANALOG_ENDPOINT_WRONG_NET');
    seen.add(id);
    if(id===bead+'.1'||id===groundLink+'.1')terminals.push({...p,net:n.name});
    return false;
  })}));
  check(seen.size===expected.size&&stripped.find(n=>n.name===supply.name).endpoints.length===0&&
    equal(before.nets,stripped.filter(n=>n.name!==supply.name)),'ANALOG_EXISTING_NET_CHANGED');
  return {analogSupply,parts,owner,assignments,supply,terminals};
}

export function verifyAnalogPins(delta,pins){
  const names=new Set(Object.values(analogPins).map(([name])=>name)),actual=pins.filter(p=>names.has(p.name));
  check(actual.length===4&&delta.assignments.every(a=>actual.some(p=>p.number===a.pin&&p.name===a.name&&p.net==='')),'ANALOG_NATIVE_PINS_OR_NET');
}
export function verifyAnalogDevice(config,component,device){
  const {bead,groundLink,vddaCaps,vrefCaps}=config,ref=component.ref,p=device.parameters;
  check(component.supplierId===device.supplierId&&component.manufacturerPart===device.manufacturerPart&&
    component.footprintUuid===device.footprint.uuid&&device.subPartNames.includes(component.subPartName)&&
    Object.keys(component.properties).every(k=>['Value','Name'].includes(k)),'ANALOG_COMPONENT_IDENTITY');
  if(ref===bead){
    check(p['Supplier Footprint']==='0603'&&p['Impedance @ Frequency']==='600Ω@100MHz'&&p['Number of Circuits']==='1'&&
      /^\d+(\.\d+)?mA$/.test(p['Current Rating'])&&parseFloat(p['Current Rating'])>=200&&
      /^\d+(\.\d+)?mΩ$/.test(p['DC Resistance(DCR)'])&&parseFloat(p['DC Resistance(DCR)'])<500&&
      component.properties.Name==='={Impedance @ Frequency}'&&component.properties.Value===undefined,'ANALOG_BEAD_SPECIFICATION');
  }else if(ref===groundLink){
    check(p.Value==='0Ω'&&p['Supplier Footprint']==='0402'&&component.properties.Value===p.Value,'ANALOG_GROUND_LINK_SPECIFICATION');
  }else{
    const bulk=[vddaCaps[0],vrefCaps[0]].includes(ref),hf=ref===vddaCaps[2],value=bulk?'1uF':hf?'10nF':'100nF';
    check(p.Value?.replace(/[µμ]/g,'u')===value&&component.properties.Value===p.Value&&p['Supplier Footprint']===(bulk?'0603':'0402')&&
      (p['Temperature Coefficient']==='X7R'||hf&&p['Temperature Coefficient']==='C0G')&&
      /^\d+(\.\d+)?V$/.test(p['Voltage Rating'])&&parseFloat(p['Voltage Rating'])>=6.3,'ANALOG_DECOUPLER_SPECIFICATION');
  }
}

export function analogPowerRoutes(delta,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines),routes=[];
  const {bead,groundLink,vddaCaps,vrefCaps}=delta.analogSupply;
  const pin=(ref,n)=>{const p=pins.get(ref+'.'+n);check(p,'ANALOG_PIN_GEOMETRY');return p;};
  function add(key,net,anchors,lines,labelAt){
    reserve(lines,anchors);routes.push({key,net,anchors,lines,labelAt});
  }
  const capRefs=[...vddaCaps,...vrefCaps],pinOneUp=pin(capRefs[0],'1').rotation===90;
  for(const [ref,number,net] of [[bead,'1','+3V3A'],[groundLink,'2','GNDA']]){
    const feed=pin(ref,'2'),caps=capRefs.map(c=>pin(c,number)).sort((a,b)=>a.x-b.x);
    const positive=number==='1',up=positive===pinOneUp,anchors=[feed,...caps],lines=[];
    check(feed.rotation===0&&caps[0].x-feed.x>=40&&caps.every(c=>c.rotation===(up?90:270)),'ANALOG_BANK_ORIENTATION');
    let y=feed.y,lastX=feed.x;
    // With pin 1 facing down, take the supply around the right edge to avoid crossing the return.
    if(!pinOneUp){
      y=up?Math.max(...caps.map(c=>c.y))+14:Math.min(...caps.map(c=>c.y))-14;
      const lane=positive?caps.at(-1).x+25:(feed.x+caps[0].x)/2;
      lines.push([feed.x,feed.y,lane,feed.y],[lane,feed.y,lane,y]);lastX=lane;
      if(positive)caps.reverse();
    }
    for(const c of caps){
      check(c.x!==lastX&&(up?c.y<y:c.y>y),'ANALOG_BANK_ORIENTATION');
      lines.push([lastX,y,c.x,y],[c.x,y,c.x,c.y]);lastX=c.x;
    }
    add(ref,net,anchors,lines,[(feed.x+Math.min(...caps.map(c=>c.x)))/2,feed.y+(positive?8:-12)]);
  }
  for(const [a,b] of [['19','20'],['21','22']]){
    const first=pin(delta.owner,a),second=pin(delta.owner,b);
    check(first.rotation===180&&second.rotation===180&&first.x===second.x&&first.y>second.y,'ANALOG_MCU_PIN_GEOMETRY');
    const lane=first.x-42;
    add('mcu-'+a,analogPins[a][1],[first,second],[[first.x,first.y,lane,first.y],[lane,first.y,lane,second.y],[lane,second.y,second.x,second.y]],
      [lane-15,(first.y+second.y)/2]);
  }
  for(const end of delta.terminals){
    const p=pin(end.ref,end.pin);check(p.rotation===180,'ANALOG_INPUT_ORIENTATION');
    reserve([[p.x,p.y,p.x-end.stubLength,p.y]],[p]);
  }
  return routes;
}
