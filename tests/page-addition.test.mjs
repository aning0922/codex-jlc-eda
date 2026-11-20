import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {appendSheetCircuit,sheetWirePlan,sheetDrcDelta,pagePreviewPng} from '../src/page-addition.mjs';
const component=ref=>({ref,designator:ref,deviceUuid:'device',libraryUuid:'library',subPartName:'one',pose:{x:20,y:40,rotation:0,mirror:false},properties:{},supplierId:'C1',manufacturerPart:'part',footprintUuid:'footprint'});
const endpoint=(ref,pin)=>({ref,pin,stubLength:20});
const before={components:[component('U1')],nets:[{name:'GND',endpoints:[endpoint('U1','1')]}],notes:[],nc:[]};
const sheet={name:'Input',placements:[{ref:'J1',xMm:2,yMm:3,rotation:0}],circuit:{components:[component('J1')],nets:[{name:'GND',endpoints:[endpoint('J1','2')]},{name:'VIN',endpoints:[endpoint('J1','1')]}],notes:[],nc:[]}};
test('select the named schematic PNG from the native multipage ZIP',()=>{
 const signature=[137,80,78,71,13,10,26,10],old=Uint8Array.from([...signature,1]),fresh=Uint8Array.from([...signature,2]);
 const zip=zipSync({'SCH_B_1-P1_2026-11-20.png':old,'SCH_B_2-24V控制入口_2026-11-20.png':fresh});
 assert.deepEqual(pagePreviewPng(zip,'24V控制入口',[{name:'P1'},{name:'24V控制入口'}]).bytes,Buffer.from(fresh));
 assert.throws(()=>pagePreviewPng(zip,'P1',[{name:'P1'},{name:'P1'}]),/MEMBERSHIP/);
});
test('a new sheet extends the existing ground without mutating the source or accepting duplicate board refs',()=>{
 const copy=structuredClone(before),all=appendSheetCircuit(before,sheet);
 assert.deepEqual(before,copy);assert.deepEqual(all.nets[0].endpoints,[endpoint('U1','1'),endpoint('J1','2')]);
 assert.throws(()=>appendSheetCircuit(before,{...sheet,placements:[]}),/PLACEMENTS_INCOMPLETE/);
 assert.throws(()=>appendSheetCircuit(before,{...sheet,circuit:{...sheet.circuit,components:[component('U1')]}}),/ALREADY_EXISTS/);
});
test('schematic routes must reach their named pins, join at actual junctions and avoid foreign pins',()=>{
 const doc={components:[{uniqueId:'J1',id:'j',pins:[{number:'1',x:10,y:10+1e-14,rotation:0},{number:'2',x:10,y:0,rotation:0}]}]};
 const v=[{net:'VIN',lines:[[10,10,30,10],[20,10,20,20]]},{net:'GND',lines:[[10,0,30,0]]}];
 assert.deepEqual(sheetWirePlan(sheet.circuit,doc,v).map(x=>x.anchors[0].pin),['1','2']);
 assert.throws(()=>sheetWirePlan(sheet.circuit,doc,v.slice(0,1)),/COVERAGE/);
 assert.throws(()=>sheetWirePlan(sheet.circuit,doc,[{...v[0],lines:[...v[0].lines,[40,10,40,20]]},v[1]]),/DISCONNECTED/);
 assert.throws(()=>sheetWirePlan(sheet.circuit,doc,[{net:'VIN',lines:[[10,0,10,10]]},v[1]]),/WRONG_PIN/);
 assert.throws(()=>sheetWirePlan(sheet.circuit,doc,[v[0],{net:'GND',lines:[[10,0,30,0],[30,0,30,10]]}]),/DIFFERENT_NET/);
});
test('DRC changes can consist only of same-network disconnected markers on newly added pads',()=>{
 const leaf=(id,n)=>({net:n,errorType:'Connection Error',explanation:{errData:{obj1:id,net:n,errorType:'No Connection'}}});
 const group=(name,list)=>({name,list,count:list.length,title:name+' ('+list.length+')'}),tree=groups=>{const n=groups.reduce((n,g)=>n+g.count,0);return [{name:'Connection Error',list:groups,count:n,title:['Connection Error','('+n+')']}];};
 const base=tree([group('GND',[leaf('old','GND')])]),added=[{pins:[{id:'new',net:'GND'},{id:'v',net:'VIN'}]}];
 const now=tree([group('GND',[leaf('old','GND'),leaf('new','GND')]),group('VIN',[leaf('v','VIN')])]);
 assert.equal(sheetDrcDelta(base,now,added).status,'matched');
 assert.equal(sheetDrcDelta(base,[...now,{name:'Clearance',list:[]}],added).status,'mismatch');
 const changed=structuredClone(now);changed[0].list[0].list[0].explanation.errData.obj1='unrelated';assert.equal(sheetDrcDelta(base,changed,added).status,'mismatch');
 const wrong=structuredClone(now);wrong[0].list[0].list[1].net='VIN';assert.equal(sheetDrcDelta(base,wrong,added).status,'mismatch');
});
