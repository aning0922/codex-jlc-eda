import test from 'node:test';
import assert from 'node:assert/strict';
import {segmentsIntersect} from '../src/board-geometry.mjs';
import {auditCopper} from '../src/copper.mjs';
import {planRepair} from '../src/repair-geometry.mjs';
// Hand-authored mathematical fixtures, no native/library captures.
test('finite segment intersection: crossing, touch, collinear, separated, point; symmetric',()=>{
 const cases=[[[0,0],[2,2],[0,2],[2,0],true],[[0,0],[1,0],[1,0],[2,1],true],[[0,0],[2,0],[1,0],[3,0],true],[[0,0],[1,0],[2,0],[3,0],false],[[0,0],[0,0],[0,0],[1,1],true],[[0,0],[0,0],[1,1],[2,2],false],[[0,0],[1,0],[0,0.001],[1,0.001],false]];
 for(const [a,b,c,d,expected]of cases){assert.equal(segmentsIntersect(a,b,c,d),expected);assert.equal(segmentsIntersect(c,d,b,a),expected);}
});
test('copper audit uses crossing segment geometry while separated/layer-disjoint segments stay open',()=>{
 const pad=(id,x,y)=>({id,number:id,net:'SIGNAL',x,y,padShape:['RECT',.2,.2],layer:1});
 const doc={status:'ok',truncated:false,counts:{components:1},components:[{uniqueId:'synthetic',pins:[pad('1',0,0),pad('2',0,2)]}]};
 const line=(id,a,b)=>({kind:'Line',primitiveId:id,net:'SIGNAL',layer:1,startX:a[0],startY:a[1],endX:b[0],endY:b[1],lineWidth:.01});
 const native={status:'ok',objects:[line('a',[0,0],[2,2]),line('b',[0,2],[2,0])]};
 assert.equal(auditCopper(doc,native).fullyConnected,true);
 native.objects[1].layer=2;assert.equal(auditCopper(doc,native).fullyConnected,false);
});
test('repair rejects missing provenance before producing a plan',()=>{
 assert.throws(()=>planRepair({}, {}, {}, {}),/REPAIR_KNOWN_PARTIAL_BASELINE_REQUIRED/);
});
test('repair detects a crossing foreign track and accepts an actually separated track',()=>{
 const mil=x=>x/.0254;
 const pad=(id,x)=>({id,number:'1',net:'SIGNAL',x:mil(x),y:mil(-10),padShape:['RECT',20,20],rotation:0,layer:1});
 const document={components:[{uniqueId:'from',pins:[pad('a',5)]},{uniqueId:'to',pins:[pad('b',15)]}]};
 const kinds=['Track','SMD Pad','TH Pad','Board Outline','Via'];
 const spacing={unit:'mm',row:kinds,column:kinds,tables:{'1':{status:1,content:kinds.map(()=>kinds.map(()=>.2))}}};
 const track={form:{data:{'1':{minValue:.1,maxValue:1}}}};
 const record={
  continuation:{selectedStage:{intent:{nets:['SIGNAL']}}},
  pcbLayoutBaseline:{plan:{board:{x:0,y:0,width:1000,height:1000}}},
  pcbRepairBaseline:{},
  pcbRuleBaseline:{config:{Spacing:{'Safe Spacing':{copperThickness1oz:spacing}},Physics:{Track:{copperThickness1oz:track}}}}
 };
 const input={unit:'mm',net:'SIGNAL',from:{uniqueId:'from',pin:'1'},to:{uniqueId:'to',pin:'1'},paths:[{layer:1,width:.25,points:[[5,-10],[15,-10]]}],vias:[]};
 const foreign={kind:'Line',primitiveId:'foreign',net:'OTHER',layer:1,startX:mil(10),endX:mil(10),startY:mil(-15),endY:mil(-5),lineWidth:mil(.25)};
 const crossing=planRepair(input,document,{objects:[foreign]},record);assert.equal(crossing.status,'mismatch');assert.ok(crossing.issues.some(i=>i.code==='REPAIR_OBSTACLE_CLEARANCE'));
 foreign.startX=foreign.endX=mil(20);assert.equal(planRepair(input,document,{objects:[foreign]},record).status,'matched');
});
