import test from 'node:test';
import assert from 'node:assert/strict';
import {zipSync} from 'fflate';
import {webcrypto} from 'node:crypto';
import {auditCopper} from '../src/copper.mjs';
import {drawingScript,circuitSchema,pageCircuitSchema,readSchematicPng} from '../src/drawing.mjs';
import {appendSheetCircuit,sheetWirePlan,sheetDrcDelta,pagePreviewPng,sourcePinStubs,sourceLabelEdits,flipPadEvidence} from '../src/page-addition.mjs';
const component=ref=>({ref,designator:ref,deviceUuid:'device',libraryUuid:'library',subPartName:'one',pose:{x:20,y:40,rotation:0,mirror:false},properties:{},supplierId:'C1',manufacturerPart:'part',footprintUuid:'footprint'});
const endpoint=(ref,pin)=>({ref,pin,stubLength:20});
const before={components:[component('U1')],nets:[{name:'GND',endpoints:[endpoint('U1','1')]}],notes:[],nc:[]};
test('a source sheet releases only explicitly deferred pins to nets present on the new sheet',()=>{
 const parent={...before,openPins:[{ref:'U1',pin:'2'},{ref:'U1',pin:'3'}]},source={ref:'U1',pin:'2',net:'VIN',pageUuid:'input',stubLength:20};
 const combined=appendSheetCircuit(parent,{...sheet,sourcePins:[source]});
 assert.deepEqual(combined.openPins,[{ref:'U1',pin:'3'}]);assert.deepEqual(combined.nets[1].endpoints.at(-1),endpoint('U1','2'));
 for(const pins of [[source,source],[{...source,pin:'1'}],[{...source,net:'UNDECLARED'}]])assert.throws(()=>appendSheetCircuit(parent,{...sheet,sourcePins:pins}));
 const doc={components:[{id:'u',uniqueId:'U1',pins:[{number:'2',x:40,y:10,rotation:180,noConnected:false}]}]};
 assert.deepEqual(sourcePinStubs([source],doc,[])[0].lines,[[40,10,20,10]]);
 assert.throws(()=>sourcePinStubs([source],doc,[[30,8,30,12]]),/COLLISION/);
});
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
 const pad={id:'j1',number:'1',net:'VIN',layer:12,x:112.1,y:60},original=[{designator:'J1',pins:[pad]}];
 const newLink=leaf('j1','VIN'),suffix='(VIN): J1_1',pos={x:11.2105,y:6};
 Object.assign(newLink,{obj1:{suffix},objs:['j1'],pos});Object.assign(newLink.explanation.errData,{obj1Suffix:suffix,position:pos,layerIds:[12]});
 const extended=tree([group('GND',[leaf('old','GND'),leaf('new','GND')]),group('VIN',[leaf('v','VIN'),newLink])]);
 const accepted=sheetDrcDelta(base,extended,added,original);assert.equal(accepted.status,'matched');assert.equal(accepted.previouslySinglePads[0].designator,'J1');
 assert.equal(sheetDrcDelta(base,extended,added,[...original,{designator:'J2',pins:[{...pad,id:'j2'}]}]).status,'mismatch');
 const moved=structuredClone(extended);moved[0].list[1].list[1].explanation.errData.position.x+=1;
 assert.equal(sheetDrcDelta(base,moved,added,original).status,'mismatch');
});

test('DRC may change the representative of an intact conductor only for the same rule and group',()=>{
 const part=(ref,id,x)=>({uniqueId:ref,designator:ref,pins:[{id,number:'1',net:'V',layer:1,x,y:0,padShape:['RECT',8,8]}]});
 const via={kind:'Via',primitiveId:'v',net:'V',viaType:0,x:0,y:0,diameter:10};
 const native={status:'ok',layers:2,objects:[via]},a=part('A','p',0),b=part('B','q',40),c=part('C','new',80);
 const doc=components=>({status:'ok',truncated:false,counts:{components:components.length},components});
 const source={document:doc([a,b]),native},copper={source,native,actual:auditCopper(doc([a,b,c]),native,{viaMembership:true})};
 const marker=(id,x,type,suffix)=>{const pos={x:x/10,y:0};return {net:'V',errorType:'Connection Error',errorObjType:type,ruleName:'Common',obj1:{typeName:type,suffix},objs:[id],pos,
  explanation:{errData:{obj1:id,obj1Type:type,obj1Suffix:suffix,net:'V',errorType:'No Connection',position:pos,layerIds:[type==='Via'?12:1]}}};};
 const tree=list=>[{name:'Connection Error',title:['Connection Error','('+list.length+')'],count:list.length,list:[{name:'V',title:'V ('+list.length+')',count:list.length,list}]}];
 const old=tree([marker('v',0,'Via','(V): v')]),fresh=marker('p',0,'SMD Pad','(V): A_1'),added=marker('new',80,'SMD Pad','(V): C_1');
 const check=(m,candidate=copper)=>sheetDrcDelta(old,tree([m,added]),[c],[a,b],[],candidate);
 assert.deepEqual(check(fresh).reassignedMarkers,[{net:'V',before:'v',after:'p',sourceGroupSize:1}]);
 assert.equal(check(fresh).status,'matched');
 assert.equal(check(marker('q',40,'SMD Pad','(V): B_1')).status,'mismatch');
 assert.equal(check({...fresh,ruleName:'Other'}).status,'mismatch');
 assert.equal(check({...fresh,errorObjType:'Via'}).status,'mismatch');
 const repeated=tree([marker('v',0,'Via','(V): v'),fresh]);
 const fewer=sheetDrcDelta(repeated,tree([fresh,added]),[c],[a,b],[],copper);
 assert.equal(fewer.status,'matched');assert.deepEqual(fewer.redundantMarkers,[{net:'V',before:'v',witness:'p',sourceGroupSize:1}]);
 assert.equal(sheetDrcDelta(repeated,tree([added]),[c],[a,b],[],copper).status,'mismatch');
});

test('a saved wire label can move only from its own visible native network attribute',()=>{
 const label={wireId:'w',net:'OUT',from:[20,30],to:[24,38]},body={parentId:'w',key:'NET',value:'OUT',valueVisible:true,align:'CENTER_BOTTOM',rotation:0,x:20,y:-30};
 const rows=[{type:'LINE',id:'l',body:{lineGroup:'w'}},{type:'ATTR',id:'a',body}];
 assert.deepEqual(sourceLabelEdits(rows,[label]),[{type:'ATTR',id:'a',before:body,after:{...body,x:24,y:-38}}]);
 for(const bad of [{...label,net:'IN'},{...label,from:[23,30]},{...label,wireId:'foreign'}])assert.throws(()=>sourceLabelEdits(rows,[bad]),/SOURCE_MISMATCH/);
 assert.throws(()=>sourceLabelEdits(rows,[label,label]),/DUPLICATE/);
});
test('a short cross-sheet stub can end before an existing wire and ordinary new sheets keep their drawing minimum',()=>{
 const p={ref:'U1',pin:'1',net:'GND',stubLength:3},doc={components:[{id:'u',uniqueId:'U1',pins:[{number:'1',x:985,y:520,rotation:0,noConnected:false}]}]},c={...before,nets:[{name:'GND',endpoints:[{ref:'U1',pin:'1',stubLength:3}]}]};
 assert.deepEqual(sourcePinStubs([p],doc,[[989,510,989,540]])[0].lines,[[985,520,988,520]]);
 assert(circuitSchema.safeParse(c).success);assert(!pageCircuitSchema.safeParse(c).success);
});
test('a native placement batch stops at an existing designator and records the completed prefix',async()=>{
 const created=[],instances=new Map(),eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'project'})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'page',parentProjectUuid:'project',documentType:1})},
  lib_Device:{get:async uuid=>({uuid})},sch_PrimitiveComponent:{getAll:async()=>[{getState_Designator:()=>'U2'}],create:async()=>{const id='part'+created.length;created.push(id);instances.set(id,{getState_PrimitiveId:()=>id,getState_OtherProperty:()=>({})});return instances.get(id);},get:async id=>instances.get(id),modify:async()=>true}};
 const run=new Function('eda','return '+drawingScript({operation:'sheet_place_batch',expectedProjectUuid:'project',schematicPageUuid:'page',components:['U1','U2','U3'].map(component)}));
 const r=await run(eda);assert.equal(r.status,'unknown');assert.deepEqual(r.written,[{ref:'U1',primitiveId:'part0'}]);assert.equal(created.length,1);
});

test('bottom placement distinguishes surface pads from unchanged fully plated round holes',()=>{
 const p={id:'p',number:'1',net:'OUT',layer:12,metallization:true,hole:['ROUND',4,4],padShape:['ELLIPSE',10,10]};
 assert.deepEqual(flipPadEvidence([{layer:1}]),{kind:'surface'});
 assert.equal(flipPadEvidence([p]).pads[0].id,'p');
 for(const x of [[{...p,metallization:false}],[p,{layer:1}],[{...p,hole:['SLOT',4,8]}],[]])assert.equal(flipPadEvidence(x),null);
});

test('large native PNG exports are transferred once, checked by checksum and released on failure',async()=>{
 const large=new Uint8Array(8*1024*1024+11);large[0]=137;large[large.length-1]=147;
 const file=new Blob([large]),target={sessionId:'test',expectedProjectUuid:'project',schematicPageUuid:'page'};
 let exports=0,corrupt=false;
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'project'})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({parentProjectUuid:'project',uuid:'page',documentType:1})},sch_ManufactureData:{getPngFile:async()=>{exports++;return file;}}};
 const adapter={invoke:async(session,code,ms,limit)=>{
  assert.equal(session,'test');const result=await new Function('eda','crypto','return '+code)(eda,webcrypto);
  assert(Buffer.byteLength(JSON.stringify(result))<limit);
  if(corrupt&&result.offset===0)result.data='AAAA'+result.data.slice(4);
  return result;
 }};
 assert.deepEqual(await readSchematicPng(adapter,target),Buffer.from(large));assert.equal(exports,1);
 corrupt=true;await assert.rejects(readSchematicPng(adapter,target),/SHEET_PNG_CHECKSUM/);assert.equal(exports,2);
 assert.equal(globalThis[Symbol.for('codex-jlc-eda:png-transfers')].size,0);
 const png=Buffer.from([137,80,78,71,13,10,26,10,12]);assert.deepEqual(pagePreviewPng(png,'Main',[{name:'Main'}]).bytes,png);
 assert.throws(()=>pagePreviewPng(png,'Other',[{name:'Main'},{name:'Other'}]),/MEMBERSHIP/);
});
