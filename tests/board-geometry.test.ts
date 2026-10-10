import test from 'node:test';import assert from 'node:assert/strict';
import {parseBoardPath,pointInBoardPath,ringRelations} from '../src/board-geometry.js';
const square=[0,0,'L',10,0,10,10,0,10,0,0];
test('M43 exact rounded R retains full source, four arcs and analytic area/bounds',()=>{const p=parseBoardPath(['R',2,100,80,60,0,10]);assert.equal(p.state,'accepted');assert.equal(p.segments?.filter(s=>s.kind==='arc').length,4);assert.equal(p.segments?.filter(s=>s.kind==='line').length,4);assert.deepEqual(p.bounds,{minX:2,minY:40,maxX:82,maxY:100});assert.equal(p.areaRaw2,4800-(4-Math.PI)*100);assert.equal(pointInBoardPath([2,100],p),'outside');assert.equal(pointInBoardPath([42,70],p),'inside');assert.equal(pointInBoardPath([42,100],p),'boundary');});
test('M43 explicit line closure/direction and point relations are separate from native cutout semantic',()=>{const p=parseBoardPath(square);assert.equal(p.state,'accepted');assert.equal(p.areaRaw2,100);assert.equal(p.direction,'counterclockwise_in_numeric_XY');assert.equal(pointInBoardPath([5,5],p),'inside');assert.equal(pointInBoardPath([10,5],p),'boundary');assert.equal(pointInBoardPath([11,5],p),'outside');});
for(const [name,path,reason] of [
 ['gap',[0,0,'L',10,0,10,10,0,10,0,.00000001],'open_path'],
 ['crossing',[0,0,'L',10,10,10,0,0,10,0,0],'self_intersection'],
 ['zero edge',[0,0,'L',10,0,10,0,0,10,0,0],'zero_length'],
 ['duplicate edge',[0,0,'L',10,0,0,0,0,10,0,0],'duplicate_edge'],
 ['zero area',[0,0,'L',1,0,2,0,0,0],'degenerate_area'],
 ['unknown curve',[0,0,'ARC',90,10,10],'unsupported_curve'],
 ['unsupported rotated R',['R',0,100,100,100,90,0],'rotated_rectangle'],
 ['invalid radius',['R',0,100,100,100,0,51],'invalid_corner_radius'],
 ['degenerate R',['R',0,100,0,100,0,0],'degenerate_area'],
 ['partial R',['R',0,100,100,100,0],'invalid_rectangle'],
] as [string,any,string][]){test('M43 rejects '+name+' without repairing original path',()=>{const original=structuredClone(path),p=parseBoardPath(path);assert.notEqual(p.state,'accepted');assert.match(p.reason!,new RegExp(reason));assert.deepEqual(path,original);});}
test('M43 rings distinguish contained, disjoint outer, touching and crossing without inventing holes',()=>{
 const outer=parseBoardPath(square),inner=parseBoardPath([2,2,'L',4,2,4,4,2,4,2,2]),touch=parseBoardPath([0,2,'L',4,2,4,4,0,4,0,2]),out=parseBoardPath([20,20,'L',24,20,24,24,20,24,20,20]);
 assert.equal(ringRelations([outer,inner])[0].state,'b_inside_a');assert.equal(ringRelations([outer,touch])[0].state,'touching_or_crossing');assert.equal(ringRelations([outer,out])[0].state,'disjoint_multiple_outer');assert.equal(ringRelations([outer,inner])[0].cutoutSemantic,'unverified');
});
