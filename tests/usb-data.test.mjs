import test from 'node:test';
import assert from 'node:assert/strict';
import {usbDataDelta,usbPortNumbers,verifyUsbDataDevice} from '../src/usb-data.mjs';

const cfg={jack:'J202',esd:'U202',cc1:'R202',cc2:'R203',senseTop:'R205',senseBottom:'R206',bulk:'C221'};
const pin=id=>{const [ref,pin]=id.split('.');return {ref,pin};};
const before={components:[{ref:'U201',manufacturerPart:'STM32H563VIT6'}],notes:[],nc:[],openPins:['U201.70','U201.71','U201.60','U201.61'].map(pin),
  nets:[{name:'+3V3',endpoints:[pin('U201.73')]},{name:'GND',endpoints:[pin('U201.74')]}]};
function circuit(){
  const c=structuredClone(before);
  c.components.push(...Object.values(cfg).map(ref=>({ref,designator:ref})));c.openPins=[pin('U201.61')];c.nc=['J202.A8','J202.B8'].map(pin);
  const assignments={'USB_VBUS':'J202.A4B9 J202.B4A9 U202.5 R205.1 C221.1','USB_CC1':'J202.A5 R202.1','USB_CC2':'J202.B5 R203.1',
    'DP_CONN':'J202.A6 J202.B6 U202.1','DM_CONN':'J202.A7 J202.B7 U202.3','USB_DP':'U202.6 U201.71','USB_DM':'U202.4 U201.70',
    'VBUS_DET':'R205.2 R206.1 U201.60','GND':'J202.A1B12 J202.B1A12 J202.13 U202.2 R202.2 R203.2 R206.2 C221.2'};
  for(const [name,v] of Object.entries(assignments)){
    const ends=v.split(' ').map(pin),net=c.nets.find(n=>n.name===name);if(net)net.endpoints.push(...ends);else c.nets.push({name,endpoints:ends});
  }return c;
}
test('both USB orientations enter the correct ESD channel, CC and VBUS stay isolated, both SBU pins are NC',()=>{
  const c=circuit(),d=usbDataDelta(before,c,cfg);assert.equal(d.parts.length,7);assert.equal(d.assignments.length,3);
  for(const [src,dst] of [['DM_CONN','DP_CONN'],['USB_CC1','USB_CC2'],['USB_VBUS','+3V3']]){
    const bad=circuit();bad.nets.find(n=>n.name===dst).endpoints.push(bad.nets.find(n=>n.name===src).endpoints.pop());
    assert.throws(()=>usbDataDelta(before,bad,cfg),/USB_DATA_PIN_NET/);
  }
  c.nc.pop();assert.throws(()=>usbDataDelta(before,c,cfg),/SBU_NC/);
});
test('Hanbo has 13 logical terminals and four distinct plated slots on its single shell pin',()=>{
  assert.equal(usbPortNumbers(cfg,'J202').length,13);const n=usbPortNumbers(cfg,'J202',true);assert.equal(n.length,16);assert.equal(n.filter(x=>x==='13').length,4);
  const dev={supplierId:'C6332278',manufacturerPart:'MC-121-L119',footprint:{uuid:'f'},subPartNames:['m'],parameters:{}};
  const spec={ref:'J202',supplierId:dev.supplierId,manufacturerPart:dev.manufacturerPart,subPartName:'m',footprintUuid:'f'};
  const names={A1B12:'GND',B1A12:'GND',A4B9:'VBUS',B4A9:'VBUS',A5:'CC1',B5:'CC2',A6:'DP1',B6:'DP2',A7:'DN1',B7:'DN2',A8:'SBU1',B8:'SBU2',13:'EH'};
  const pins=Object.entries(names).map(([pinNumber,pinName])=>({pinNumber,pinName}));
  const pads=['A1B12','A4B9','B8','A5','B7','A6','A7','B6','A8','B5','B4A9','B1A12'].map((padNumber,i)=>({padNumber,shape:'RECT',layerIds:[1],
    x:[-3.2,-2.4,-1.75,-1.25,-.75,-.25,.25,.75,1.25,1.75,2.4,3.2][i]/.0254,y:80,height:1.15/.0254,width:(i<2||i>9?.6:.3)/.0254}));
  for(const x of [-4.32,4.32])for(const y of [0,4.18])pads.push({padNumber:'13',x:x/.0254,y:y/.0254,plated:true,holeType:'SLOT',layerIds:[1,2],slotSize:{length:(y?1.7:1.4)/.0254,width:.6/.0254}});
  const verify=()=>verifyUsbDataDevice(cfg,spec,{device:dev,footprintGeometry:{geometry:{pads}},symbolGeometry:{geometry:{pins}}});
  verify();pads.at(-1).x=pads.at(-3).x;assert.throws(verify,/SHELL_SLOTS/);
});
