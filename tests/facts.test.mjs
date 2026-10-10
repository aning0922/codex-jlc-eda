import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { parseNetlist, compareAssignments, normalizeDevice, summarizeModel } from '../src/facts.mjs';
import { factsScript } from '../src/native-facts.mjs';
import { JlcEdaAdapter } from '../src/adapter.mjs';
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;

function fixture() {
  const raw = { version: '2.0.0', projectId: 'p', components: {
    unique1: { props: { 'Unique ID': 'unique1', Designator: 'U3', 'Convert to PCB': 'yes' },
      pinInfoMap: {
        '1': { number: '1', name: 'OUT', net: 'SIGNAL', props: { 'Pin Number': '1' } },
        '2': { number: '2', name: 'NC', net: '', props: { 'Pin Number': '2' } }
      } }
  } };
  const schematic = [{ truncated: false, components: [
    { id: 's1', uniqueId: 'unique1', designator: 'U3', subPartName: 'A', pins: [{ number: '1', noConnected: false }] },
    { id: 's2', uniqueId: 'unique1', designator: 'U3', subPartName: 'B', pins: [{ number: '2', noConnected: true }] }
  ] }];
  const pcb = { truncated: false, components: [{ id: 'f1', uniqueId: 'unique1', designator: 'U3', pins: [
    { id: 'pad1', number: '1', net: 'SIGNAL' }, { id: 'pad2', number: '2', net: '' }
  ] }] };
  return { raw, schematic, pcb };
}

test('native logical netlists reject a foreign project and malformed or ambiguous pin numbers', () => {
  const { raw } = fixture();
  assert.throws(() => parseNetlist(JSON.stringify(raw), 'another'), e => e.code === 'NETLIST_TARGET_MISMATCH');
  raw.components.unique1.pinInfoMap['1'].net = null;
  assert.throws(() => parseNetlist(JSON.stringify(raw), 'p'), e => e.code === 'NETLIST_PIN_SCHEMA');
  raw.components.unique1.pinInfoMap['1'].net = 'SIGNAL';
  raw.components.unique1.pinInfoMap['1'].props['Pin Number'] = '99';
  assert.equal(parseNetlist(JSON.stringify(raw), 'p').issues[0].code, 'PIN_NUMBER_MAPPING_UNVERIFIED');
});

test('multi-unit symbols merge by unique id and retain an intentional unconnected pin', () => {
  const { raw, schematic, pcb } = fixture();
  const result = compareAssignments(parseNetlist(JSON.stringify(raw), 'p'), schematic, pcb);
  assert.equal(result.status, 'matched');
  assert.equal(result.matchedPinAssignments, 2);
  assert.equal(result.multiUnitComponents[0].symbolInstances, 2);
  assert.equal(result.coverage.copperConnectivityChecked, false);
});

test('wrong pad nets, missing pins and duplicate footprint identity cannot pass assignment checks', () => {
  for (const mutate of [
    x => { x.pcb.components[0].pins[0].net = 'POWER'; },
    x => { x.pcb.components[0].pins.pop(); },
    x => { x.schematic[0].components[0].pins = []; },
    x => { x.pcb.components.push(structuredClone(x.pcb.components[0])); },
    x => { x.schematic[0].components[0].pins[0].noConnected = true; },
    x => { x.pcb.components[0].pins.push({ id: 'unmarked', number: '', net: 'GND' }); }
  ]) {
    const x = fixture(); mutate(x);
    assert.equal(compareAssignments(parseNetlist(JSON.stringify(x.raw), 'p'), x.schematic, x.pcb).status, 'mismatch');
  }
});

test('incomplete snapshots and missing identities report unknown; empty designs are not a passing match', () => {
  const x = fixture(); x.schematic[0].truncated = true;
  assert.equal(compareAssignments(parseNetlist(JSON.stringify(x.raw), 'p'), x.schematic, x.pcb).status, 'unknown');
  x.schematic[0].truncated = false; delete x.pcb.components[0].uniqueId;
  assert.equal(compareAssignments(parseNetlist(JSON.stringify(x.raw), 'p'), x.schematic, x.pcb).status, 'unknown');
  const empty = parseNetlist(JSON.stringify({ version:'2.0.0',projectId:'p',components:{} }), 'p');
  assert.equal(compareAssignments(empty, [], { components:[] }).status, 'empty');
});

test('a pair split from a three-pin schematic net is a real assignment difference', () => {
  const x=fixture();
  x.raw.components.unique1.pinInfoMap['2'].net='SIGNAL';
  x.raw.components.unique1.pinInfoMap['3']={number:'3',name:'THIRD',net:'SIGNAL',props:{'Pin Number':'3'}};
  x.schematic[0].components[1].pins[0].noConnected=false;
  x.schematic[0].components[1].pins.push({number:'3',noConnected:false});
  x.pcb.components[0].pins[0].net='SPLIT';
  x.pcb.components[0].pins[1].net='SIGNAL';
  x.pcb.components[0].pins.push({id:'pad3',number:'3',net:'SPLIT'});
  const result=compareAssignments(parseNetlist(JSON.stringify(x.raw),'p'),x.schematic,x.pcb);
  assert.equal(result.status,'mismatch');assert.equal(result.matchedPinAssignments,1);
  assert.deepEqual(result.mismatches.map(m=>m.number),['1','3']);
});

test('library normalization preserves identity and marks commercial and datasheet verification absent', () => {
  const result = normalizeDevice({ uuid:'d',name:'TEST',property:{supplierId:'C1',
    otherProperty:{Datasheet:'https://example.org/d.pdf',Voltage:'3.3V'}},
    association:{symbol:{uuid:'s',libraryUuid:'different-library'},footprintUuid:'f'} }, 'requested-library');
  assert.equal(result.symbol.libraryUuid, 'different-library');
  assert.equal(result.footprint.libraryUuid, 'requested-library');
  assert.equal(result.parameters.Voltage, '3.3V');
  assert.equal(result.provenance.liveStockVerified, false);
  assert.equal(result.provenance.datasheetContentVerified, false);
});

test('native search and model reads enforce the project and library target before retrieving content', async () => {
  let queries = 0, reads = 0;
  const eda = { dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'p'})},
    dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'different',parentLibraryUuid:'lib',documentType:4})},
    lib_Device:{search:async()=>{queries++;return[];}},
    pcb_PrimitivePad:{getAll:async()=>{reads++;return[];}} };
  const wrong = await new AsyncFunction('eda','return await '+factsScript({operation:'search',expectedProjectUuid:'wrong',query:'test'}))(eda);
  assert.equal(wrong.code, 'TARGET_MISMATCH'); assert.equal(queries, 0);
  const model = await new AsyncFunction('eda','return await '+factsScript({operation:'model_read',expectedProjectUuid:'p',kind:'footprint',modelUuid:'m',libraryUuid:'lib'}))(eda);
  assert.equal(model.code, 'MODEL_NOT_READY_OR_CHANGED'); assert.equal(reads, 0);
});

test('a library lookup finishing after a target switch returns unknown', async () => {
  let calls = 0;
  const eda = {dmt_Project:{getCurrentProjectInfo:async()=>({uuid:++calls===1?'p':'changed'})},
    lib_LibrariesList:{getSystemLibraryUuid:async()=>'library'},lib_Device:{search:async()=>[{uuid:'d'}]}};
  const r = await new AsyncFunction('eda','return await '+factsScript({operation:'search',expectedProjectUuid:'p',query:'test',limit:5,page:1}))(eda);
  assert.equal(r.code, 'TARGET_CHANGED_DURING_READ'); assert.equal(r.hits, undefined);
});

test('model source parsing preserves the reported origin without inventing physical dimensions', () => {
  const source = '{"type":"CANVAS"}||{"originX":15,"originY":-20}|\n';
  const result = summarizeModel({source,kind:'symbol',canvasOrigin:null,pins:[],coverage:{mechanicalBodyBoundsVerified:false}});
  assert.deepEqual(result.canvasOrigin,{originX:15,originY:-20});
  assert.equal(result.coverage.mechanicalBodyBoundsVerified,false);
  assert.equal(result.source,undefined); assert.equal(result.sourceSha256.length,64);
  assert.equal(summarizeModel({source:'unrecognized',pins:[]}).sourceCoverage,'unknown');
});

test('repeated opens within one service reuse its live owned session without another open command', async () => {
  const dir=await mkdtemp(path.join(os.tmpdir(),'jlc-reuse-'));
  try {
    const file=path.join(dir,'file.eprj2');await writeFile(file,'fixture');let opens=0;
    const adapter=new JlcEdaAdapter({inspectionRoot:dir,executable:'/unused',runner:async(_exe,args)=>{
      if(args[0]==='doctor')return{value:{connected:true}};
      if(args[0]==='session')return{value:opens?[{sessionId:'own-'+opens,status:'alive'}]:[]};
      if(args[0]==='open'){opens++;await writeFile(args[2],'simulated editor history');return{value:{sessionId:'own-'+opens,path:args[2]}};}
      if(args[0]==='invoke')return{value:{status:'ok',project:{uuid:'p'},documents:[]}};
      throw new Error('unexpected');
    }});
    const first=await adapter.dispatch('jlc_eda_open_project',{path:file});
    assert.equal(first.inspectionCopy,true);assert.notEqual(first.path,file);
    assert.equal(await readFile(file,'utf8'),'fixture');
    assert.equal(await readFile(first.path,'utf8'),'simulated editor history');
    const again=await adapter.dispatch('jlc_eda_open_project',{path:file});
    assert.equal(again.reusedOwnedSession,true);assert.equal(opens,1);
    await writeFile(file,'external source update');
    const fresh=await adapter.dispatch('jlc_eda_open_project',{path:file});
    assert.notEqual(fresh.path,first.path);assert.equal(opens,2);
    assert.equal(await readFile(file,'utf8'),'external source update');
  } finally {await rm(dir,{recursive:true,force:true});}
});
