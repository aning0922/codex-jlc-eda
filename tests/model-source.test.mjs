import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeSourceModel} from '../src/facts.mjs';
import {parseNativeSource} from '../src/native-records.mjs';
import {factsScript} from '../src/native-facts.mjs';
import {JlcEdaAdapter} from '../src/adapter.mjs';
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const row=(type,id,body)=>({header:{type,id},body});
function fixture(kind='symbol') {
 const records=[row('DOCHEAD',undefined,{uuid:'m',docType:kind==='symbol'?'SYMBOL':'FOOTPRINT'}),row('CANVAS','CANVAS',{originX:3,originY:-2})];
 if(kind==='symbol')records.push(row('PART','unit',{title:'unit'}),...['1','2'].flatMap((n,i)=>[
  row('PIN','p'+n,{partId:'unit',x:i?20:-20,y:0,length:10,rotation:i?180:0,display:true,pinShape:'NONE'}),
  row('ATTR','a'+n,{parentId:'p'+n,key:'Pin Number',value:n})]));
 else records.push(row('PAD','p1',{num:'1',centerX:-29.66,centerY:0,padAngle:90,layerId:1,hole:null,specialPad:[],padOffsetX:.005,padOffsetY:0,defaultPad:{padType:'RECT',width:31.751,height:34.016,radius:0}}));
 const data={status:'ok',kind,modelUuid:'m',libraryUuid:'lib',metadata:{uuid:'m',libraryUuid:'lib'},sourceScope:'requested_external_library',sourceApi:kind==='symbol'?'eda.lib_Symbol.getDocumentSource':'eda.lib_Footprint.getDocumentSource'};
 return {records,data,read:()=>summarizeSourceModel({...data,source:records.map(r=>JSON.stringify(r.header)+'||'+JSON.stringify(r.body)+'|').join('\n')})};
}
test('source models retain identity, native units, nonzero origin and terminal directions without guessing body bounds',()=>{
 const s=fixture().read();assert.equal(s.status,'ok');assert.equal(s.coordinateSystem.unit,'10mil');assert.deepEqual(s.pins.map(p=>[p.number,p.x,p.rotation,p.length]),[['1',-20,0,10],['2',20,180,10]]);assert.equal(s.canvasOrigin.originY,-2);assert.equal(s.persistenceVerified,false);assert.equal(s.terminalBounds,null);
 const p=fixture('footprint').read();assert.equal(p.status,'ok');assert.equal(p.coordinateSystem.unit,'mil');assert.deepEqual(p.pins[0].padShape,['RECT',31.751,34.016,0]);assert.equal(p.pins[0].padOffset.x,.005);assert.equal(p.pins[0].rotation,90);
});
test('LF and CRLF parse equivalently without changing escaped content or deletion identity',()=>{
 const s='{"type":"ATTR","id":"a"}||{"value":"inside\\r\\n|"}|\n{"type":"LINE","id":"gone","ticket":3}|||\n';
 assert.deepEqual(parseNativeSource(s),parseNativeSource(s.replaceAll('\n','\r\n')));assert.equal(parseNativeSource(s)[0].body.value,'inside\r\n|');assert.equal(parseNativeSource(s)[1].deleted,true);
 const f=fixture();const source=f.records.map(r=>JSON.stringify(r.header)+'||'+JSON.stringify(r.body)+'|').join('\r\n');assert.deepEqual(summarizeSourceModel({...f.data,source}).pins,f.read().pins);
 assert.throws(()=>parseNativeSource('{"type":"LINE","id":"gone"}|||\r\n'));
});
test('missing/foreign metadata, DOCHEAD, origin, pin number, geometry and ambiguous active records do not pass',()=>{
 for(const mutate of [f=>delete f.data.metadata,f=>f.data.metadata.libraryUuid='foreign',f=>delete f.data.sourceApi,f=>f.records[0].body.uuid='foreign',f=>f.records[1].body.originX=null,f=>f.records[4].body.value='',f=>f.records[3].body.rotation=null,f=>f.records.push(f.records[3])]){const f=fixture();mutate(f);assert.notEqual(f.read().status,'ok');}
 assert.equal(summarizeSourceModel({...fixture().data,source:undefined}).code,'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE');
 assert.equal(summarizeSourceModel({...fixture().data,source:'not native'}).code,'MODEL_SOURCE_FORMAT_UNSUPPORTED');
 const p=fixture('footprint');p.records[2].body.hole={diameter:1};assert.equal(p.read().status,'unsupported');
});
test('native source path binds project/library and reports undefined without invoking canvas or save APIs',async()=>{
 const f=fixture(),source=f.records.map(r=>JSON.stringify(r.header)+'||'+JSON.stringify(r.body)+'|').join('\n');let reads=0;
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'project'})},lib_LibrariesList:{getProjectLibraryUuid:async()=> 'project-lib'},lib_Symbol:{get:async()=>f.data.metadata,getDocumentSource:async()=>{reads++;return source;}}};
 const p={expectedProjectUuid:'project',libraryUuid:'lib',modelUuid:'m',kind:'symbol',operation:'model_source'};
 const run=()=>new AsyncFunction('eda','return await '+factsScript(p))(eda);
 assert.equal((await run()).status,'ok');assert.equal(reads,1);
 eda.lib_Symbol.getDocumentSource=async()=>undefined;assert.equal((await run()).code,'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE');
 eda.lib_Symbol.get=async()=>({uuid:'wrong',libraryUuid:'lib'});assert.equal((await run()).code,'LIBRARY_TARGET_MISMATCH');
 p.expectedProjectUuid='wrong';assert.equal((await run()).code,'TARGET_MISMATCH');
});
test('public adapter uses direct source and never hides a source failure with canvas fallback',async()=>{
 const a=new JlcEdaAdapter();let calls=0;
 a.invoke=async()=>{calls++;return {status:'unknown',code:'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE'};};
 const r=await a.jlc_eda_read_library_model({});assert.equal(r.code,'MODEL_SOURCE_UNAVAILABLE_OR_TOO_LARGE');assert.equal(calls,1);
 const f=fixture();a.invoke=async()=>({...f.data,source:f.records.map(r=>JSON.stringify(r.header)+'||'+JSON.stringify(r.body)+'|').join('\n')});
 assert.equal((await a.jlc_eda_read_library_model({})).status,'ok');
});
test('standard connector round plated through holes retain drill dimensions and reject slot, off-center or invalid drills',()=>{
 const make=()=>{const f=fixture('footprint'),p=f.records[2].body;Object.assign(p,{layerId:12,padOffsetX:0,padOffsetY:0,plated:true,padType:'NORMAL',hole:{holeType:'ROUND',width:20,height:20}});return f;};
 const f=make(),r=f.read();assert.equal(r.status,'ok');assert.deepEqual(r.pins[0].hole,['ROUND',20]);assert.equal(r.pins[0].plated,true);assert.equal(r.pins[0].sourceHole.width,20);
 for(const change of [p=>p.plated=false,p=>p.hole.holeType='SLOT',p=>p.hole.height=21,p=>p.hole.width=-1,p=>p.hole.width=p.hole.height=40,p=>p.padOffsetY=1,p=>p.layerId=1]){const bad=make();change(bad.records[2].body);assert.notEqual(bad.read().status,'ok');}
});
