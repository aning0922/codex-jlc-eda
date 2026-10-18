import test from 'node:test';
import assert from 'node:assert/strict';
import {JlcEdaAdapter} from '../src/adapter.mjs';
test('lossless native envelope preserves large Unicode strings before CLI serialization',async()=>{
 const adapter=new JlcEdaAdapter(),value={status:'ok',source:'x'.repeat(16383)+'电阻 1kΩ ±1% 😀'};
 adapter.invoke=async(session,code)=>{
  const native=await new Function('return '+code)();
  const wire=JSON.stringify(native);assert.ok([...wire].every(c=>c.charCodeAt(0)<128));
  return JSON.parse(wire);
 };
 assert.deepEqual(await adapter.invokeLossless('s',JSON.stringify(value)),value);
});
test('document and combined connectivity readers select the lossless envelope',async()=>{
 const adapter=new JlcEdaAdapter();let calls=0;
 adapter.invoke=async()=>{throw Error('Raw Unicode transport selected');};
 adapter.invokeLossless=async()=>{calls++;return {status:'unknown',code:'fixture'};};
 assert.equal((await adapter.jlc_eda_read_document({})).code,'fixture');
 assert.equal((await adapter.jlc_eda_read_connectivity({})).code,'fixture');assert.equal(calls,2);
});
