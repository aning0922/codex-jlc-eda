import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=fileURLToPath(new URL('./fixtures/zip64-child.mjs',import.meta.url));
function isolated(mode){
 const r=spawnSync(process.execPath,[child,mode],{encoding:'utf8',timeout:1500,killSignal:'SIGKILL',maxBuffer:65536});
 assert.equal(r.error,undefined,'ZIP parsing must finish within the 1500 ms wall-clock limit');
 assert.equal(r.signal,null);assert.equal(r.status,0,r.stderr);
 return JSON.parse(r.stdout);
}
test('malformed ZIP64 missing required extra field is rejected within a bounded child process',()=>{
 const r=isolated('missing-extra');assert.equal(r.state,'rejected');assert.equal(r.code,13);assert.match(r.message,/invalid zip data/i);
});
test('valid ZIP64 empty stored entry remains readable in a bounded child process',()=>{
 assert.deepEqual(isolated('valid'),{state:'completed',files:{a:0}});
});
