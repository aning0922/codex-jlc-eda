import {isDeepStrictEqual as equal} from 'node:util';
import {powerWireSpace} from './digital-power.mjs';

function check(ok,code){if(!ok)throw Object.assign(new Error(code),{code,status:'failed'});}
const key=p=>p.ref+'.'+p.pin;
export function usbBackupDelta(before,after,usbBackupSupply){
  const {holder,diode,usbBulk,usbBypass,backupBypass}=usbBackupSupply;
  const caps=[usbBulk,usbBypass,backupBypass],refs=new Set([holder,diode,...caps]);
  check(after&&refs.size===5&&/^BT\d+$/.test(holder)&&/^D\d+$/.test(diode)&&caps.every(ref=>/^C\d+$/.test(ref)),'USB_BACKUP_COMPONENTS_REQUIRED');
  const parts=after.components.filter(c=>refs.has(c.ref));
  check(parts.length===5&&parts.every(c=>c.ref===c.designator)&&equal(before.components,after.components.filter(c=>!refs.has(c.ref)))&&
    equal(before.notes,after.notes)&&equal(before.nc,after.nc),'USB_BACKUP_OLD_CIRCUIT_CHANGED');
  const remaining=new Set((after.openPins??[]).map(key)),open=before.openPins??[],released=open.filter(p=>!remaining.has(key(p)));
  const owner=released[0]?.ref;
  check(equal(open.filter(p=>remaining.has(key(p))),after.openPins)&&equal(released.map(p=>p.pin).sort(),['6','73'])&&
    released.every(p=>p.ref===owner)&&before.components.find(c=>c.ref===owner)?.manufacturerPart==='STM32H563VIT6','USB_BACKUP_OPEN_PIN_SCOPE');
  const assignments=[{ref:owner,pin:'6',name:'VBAT',net:'VBAT'},{ref:owner,pin:'73',name:'VDDUSB',net:'+3V3'}];
  const expected=new Map(assignments.map(p=>[key(p),p.net]));
  for(const [ref,one,two] of [[holder,'GND','VBAT_CELL'],[diode,'VBAT','VBAT_CELL'],[usbBulk,'+3V3','GND'],
    [usbBypass,'+3V3','GND'],[backupBypass,'VBAT','GND']]){
    expected.set(ref+'.1',one);expected.set(ref+'.2',two);
  }
  const newNetNames=['VBAT_CELL','VBAT'],oldNames=new Set(before.nets.map(n=>n.name));
  check(['+3V3','GND'].every(k=>oldNames.has(k))&&newNetNames.every(k=>!oldNames.has(k)),'USB_BACKUP_RAILS_REQUIRED');
  const seen=new Set(),terminals=[],ports=new Set([holder+'.1',diode+'.1',backupBypass+'.2']);
  const stripped=after.nets.map(n=>({...n,endpoints:n.endpoints.filter(p=>{
    const k=key(p);if(!expected.has(k))return true;
    check(!seen.has(k)&&expected.get(k)===n.name,'USB_BACKUP_ENDPOINT_WRONG_NET');seen.add(k);
    if(ports.has(k))terminals.push({...p,net:n.name});
    return false;
  })}));
  check(seen.size===expected.size&&newNetNames.every(name=>stripped.some(n=>n.name===name&&!n.junction&&!n.endpoints.length))&&
    equal(before.nets,stripped.filter(n=>!newNetNames.includes(n.name))),'USB_BACKUP_EXISTING_NET_CHANGED');
  return {usbBackupSupply,parts,owner,assignments,newNetNames,terminals};
}

export function verifyUsbBackupPins(delta,pins){
  const actual=pins.filter(p=>['VBAT','VDDUSB'].includes(p.name));
  check(actual.length===2&&delta.assignments.every(a=>actual.some(p=>p.number===a.pin&&p.name===a.name&&p.net==='')),'USB_BACKUP_NATIVE_PINS_OR_NET');
}
function verifyHolderLands(pads){
  const [one,two]=['1','2'].map(n=>pads.find(p=>p.padNumber===n));
  const mm=(mil,value)=>Math.abs(mil*.0254-value)<.005;
  // The floor contact is negative; the right-hand rim contact is positive in Q&J's top view.
  check(one&&two&&mm(one.width,4.5)&&mm(one.height,2.4)&&mm(two.width,3.05)&&mm(two.height,3.4)&&
    mm(two.x-one.x,21.175)&&mm(two.y-one.y,0),'USB_BACKUP_HOLDER_LAND_POLARITY');
}
export function verifyPolarizedFootprint(d,spec,part,models,reference){
  const model=models.get(part.footprint.uuid),meta=model?.rows.filter(r=>r.type==='META')??[];
  check(model?.docType==='FOOTPRINT'&&meta.length===1&&meta[0].body.source===spec.footprintUuid+'|'+spec.libraryUuid,'USB_BACKUP_PROJECT_FOOTPRINT_SOURCE');
  const pads=model.rows.filter(r=>r.type==='PAD').map(r=>r.body);
  if(!equal(pads.map(p=>p.num).sort(),['1','2'])||!pads.every(p=>p.layerId===1&&p.hole===null&&p.defaultPad?.padType==='RECT'&&
    [p.centerX,p.centerY,p.padOffsetX,p.padOffsetY].every(Number.isFinite)&&!p.specialPad?.length)){
    const fields=['num','layerId','hole','centerX','centerY','padOffsetX','padOffsetY','defaultPad','specialPad'];
    throw Object.assign(Error('USB_BACKUP_PROJECT_PADS'),{code:'USB_BACKUP_PROJECT_PADS',status:'unknown',
      target:{ref:spec.ref,pads:pads.map(p=>Object.fromEntries(fields.map(k=>[k,p[k]])))}});
  }
  const lands=pads.map(p=>{
    const source=reference.find(q=>q.padNumber===p.num),x=p.centerX+p.padOffsetX,y=p.centerY+p.padOffsetY;
    const near=(a,b)=>Math.abs(a-b)*.0254<.005;
    check(source?.shape==='RECT'&&equal(source.layerIds,[1])&&near(source.x,p.centerX)&&near(source.y,p.centerY)&&near(source.x,x)&&near(source.y,y)&&
      Math.abs(source.width-p.defaultPad.width)<1e-5&&Math.abs(source.height-p.defaultPad.height)<1e-5&&source.rotation===p.padAngle,'USB_BACKUP_PROJECT_COPPER_GEOMETRY');
    return {padNumber:p.num,x,y,width:p.defaultPad.width,height:p.defaultPad.height,offsetX:p.padOffsetX,offsetY:p.padOffsetY,radius:p.defaultPad.radius};
  });
  if(spec.ref===d.usbBackupSupply.holder)verifyHolderLands(lands);
  else check(lands.find(p=>p.padNumber==='1').x<lands.find(p=>p.padNumber==='2').x,'USB_BACKUP_BLOCKING_DIODE_POLARITY');
  return {ref:spec.ref,footprintUuid:model.uuid,source:meta[0].body.source,unit:'mil',lands};
}
export function verifyUsbBackupDevice(config,part,{device,footprintGeometry,symbolGeometry}){
  const p=device.parameters,pads=footprintGeometry.geometry.pads,pins=symbolGeometry.geometry.pins;
  check(part.supplierId===device.supplierId&&part.manufacturerPart===device.manufacturerPart&&part.footprintUuid===device.footprint.uuid&&
    device.subPartNames.includes(part.subPartName)&&Object.keys(part.properties).every(k=>['Value','Name'].includes(k)),'USB_BACKUP_COMPONENT_IDENTITY');
  if(part.ref===config.holder){
    check(device.supplierId==='C5377561'&&device.manufacturerPart==='BS08A3B0J001-TP'&&part.properties.Name==='CR2032'&&
      part.properties.Value===undefined&&pads.every(p=>p.shape==='RECT'&&equal(p.layerIds,[1])),'USB_BACKUP_HOLDER_REQUIRED');
    verifyHolderLands(pads);
  }else if(part.ref===config.diode){
    check(device.supplierId==='C426766'&&device.manufacturerPart==='BAS70H,115'&&p['Supplier Footprint']==='SOD-123F'&&
      part.properties.Name==='BAS70H'&&part.properties.Value===undefined&&
      pins.some(v=>v.pinNumber==='1'&&v.pinName==='C')&&pins.some(v=>v.pinNumber==='2'&&v.pinName==='A')&&
      pads.every(q=>q.shape==='RECT'&&equal(q.layerIds,[1])),'USB_BACKUP_BLOCKING_DIODE_POLARITY');
  }else{
    const bulk=part.ref===config.usbBulk;
    check(p.Value?.replace(/[µμ]/g,'u')===(bulk?'1uF':'100nF')&&part.properties.Value===p.Value&&part.properties.Name==='={Value}'&&
      p['Temperature Coefficient']==='X7R'&&p['Supplier Footprint']===(bulk?'0603':'0402')&&
      /^\d+(\.\d+)?V$/.test(p['Voltage Rating'])&&parseFloat(p['Voltage Rating'])>=6.3,'USB_BACKUP_DECOUPLER_SPECIFICATION');
  }
}
export function verifyHolderSymbol(model){
  const plates=model.symbolPolylines;
  check(model.status==='ok'&&plates?.length===4&&plates.every(p=>!p.closed&&p.points.length===2&&p.points[0][0]===p.points[1][0]),'USB_BACKUP_HOLDER_SYMBOL_UNPROVEN');
  const sorted=plates.map(p=>({x:p.points[0][0],length:Math.abs(p.points[0][1]-p.points[1][1])})).sort((a,b)=>a.x-b.x);
  const [negative,positive]=['1','2'].map(n=>model.pins.find(p=>p.number===n));
  check(negative&&positive&&negative.x<sorted[0].x&&positive.x>sorted[3].x&&
    sorted[0].length===sorted[2].length&&sorted[1].length===sorted[3].length&&sorted[0].length>0&&
    sorted[1].length>sorted[0].length,'USB_BACKUP_HOLDER_SYMBOL_POLARITY');
}

export function usbBackupRoutes(delta,doc,oldLines){
  const {pins,reserve}=powerWireSpace(doc,oldLines),routes=[];
  const {holder,diode,usbBulk,usbBypass,backupBypass}=delta.usbBackupSupply;
  const pin=(ref,n,rotation)=>{
    const p=pins.get(ref+'.'+n);check(p?.rotation===rotation,'USB_BACKUP_PIN_ORIENTATION');return p;
  };
  function wire(key,net,anchors,lines,labelAt){reserve(lines,anchors);routes.push({key,net,anchors,lines,labelAt});}
  const positive=pin(holder,'2',0),anode=pin(diode,'2',180);
  check(positive.y===anode.y&&anode.x-positive.x>=36,'USB_BACKUP_HOLDER_DIODE_POSITION');
  wire('cell','VBAT_CELL',[positive,anode],[[positive.x,positive.y,anode.x,anode.y]],[(positive.x+anode.x)/2,anode.y+8]);
  const battery=pin(delta.owner,'6',180),bypass=pin(backupBypass,'1',0),elbow=(battery.x+bypass.x)/2;
  check(battery.x-bypass.x>=28&&battery.y>bypass.y,'USB_BACKUP_BYPASS_POSITION');
  wire('backup','VBAT',[battery,bypass],[[battery.x,battery.y,elbow,battery.y],[elbow,battery.y,elbow,bypass.y],[elbow,bypass.y,bypass.x,bypass.y]],[(battery.x+elbow)/2,battery.y+8]);
  const usb=pin(delta.owner,'73',0),caps=[usbBulk,usbBypass].map(ref=>pin(ref,'1',90)).sort((a,b)=>a.x-b.x);
  const [near,far]=caps,lane=usb.x+24,upper=usb.y-22;
  check(lane<near.x&&near.x<far.x&&caps.every(p=>p.y<upper),'USB_BACKUP_USB_BANK_POSITION');
  wire('usb','+3V3',[usb,...caps],[[usb.x,usb.y,lane,usb.y],[lane,usb.y,lane,upper],[lane,upper,near.x,upper],
    [near.x,upper,far.x,upper],...caps.map(p=>[p.x,upper,p.x,p.y])],[(near.x+far.x)/2,upper+7]);
  const gnds=[usbBulk,usbBypass].map(ref=>pin(ref,'2',270)).sort((a,b)=>a.x-b.x),[g1,g2]=gnds,lower=Math.min(g1.y,g2.y)-17;
  wire('usb-ground','GND',gnds,[[g1.x,g1.y,g1.x,lower],[g1.x,lower,g2.x,lower],[g2.x,lower,g2.x,g2.y]],[(g1.x+g2.x)/2,lower-12]);
  for(const end of delta.terminals){
    const rotation=end.ref===diode?0:180,p=pin(end.ref,end.pin,rotation);
    reserve([[p.x,p.y,p.x+(rotation===0?1:-1)*end.stubLength,p.y]],[p]);
  }
  return routes;
}
