import test from 'node:test';
import assert from 'node:assert/strict';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {p3Schemas} from '../src/p3.mjs';
import {rulesSchema} from '../src/rules.mjs';
import {criticalPrimitives,criticalRuns,verifyAddedCopper} from '../src/pcb-validation.mjs';
import {checkPlannedCopper} from '../src/repair-geometry.mjs';

const target={sessionId:'session',expectedProjectUuid:'project',schematicPageUuid:'page',schematicUuid:'sch',pcbDocumentUuid:'pcb',workDirectory:'/task',requestId:'request'};
const rules={unit:'mm',copperClearance:0.2,boardClearance:0.3,track:{minimum:0.2,default:0.25,maximum:1},via:{diameter:0.6,hole:0.3},manufacturingReference:'documented process',clearanceOverrides:[{objects:['SMD Pad','Track'],minimum:0.2}]};

test('public rule and routing schemas avoid tuple items arrays rejected by the actual Codex host',()=>{
  function inspect(node){
    if(!node||typeof node!=='object')return;
    assert.equal(Array.isArray(node.items),false,'host cannot deserialize tuple items');
    for(const value of Object.values(node))inspect(value);
  }
  for(const name of ['jlc_eda_configure_pcb_rules','jlc_eda_route_pcb'])inspect(zodToJsonSchema(p3Schemas[name],{$refStrategy:'none'}));
  const r=zodToJsonSchema(p3Schemas.jlc_eda_route_pcb,{$refStrategy:'none'}).properties.critical.properties.waypoints.items;
  assert.deepEqual({min:r.minItems,max:r.maxItems,type:r.items.type},{min:2,max:2,type:'number'});
  const c=zodToJsonSchema(rulesSchema,{$refStrategy:'none'}).properties.clearanceOverrides.items.properties.objects;
  assert.deepEqual({min:c.minItems,max:c.maxItems,type:c.items.type},{min:2,max:2,type:'string'});
});

test('homogeneous pairs preserve existing wire format and reject wrong cardinality, values and rule ranges',()=>{
  assert.deepEqual(rulesSchema.parse(rules).clearanceOverrides,rules.clearanceOverrides);
  for(const objects of [[],['Track'],['Track','SMD Pad','Via'],['Track',3],['','Track']])assert.equal(rulesSchema.safeParse({...rules,clearanceOverrides:[{objects,minimum:0.2}]}).success,false);
  assert.equal(rulesSchema.safeParse({...rules,track:{minimum:1,default:0.2,maximum:0.3}}).success,false);
  const p={...target,phase:'critical',critical:{net:'N',from:{uniqueId:'a',pin:'1'},to:{uniqueId:'b',pin:'1'},waypoints:[[1,2]],layer:1,width:0.25}};
  assert.deepEqual(p3Schemas.jlc_eda_route_pcb.parse(p).critical.waypoints,[[1,2]]);
  for(const point of [[],[1],[1,2,3],[1,'2'],[1,Infinity]])assert.equal(p3Schemas.jlc_eda_route_pcb.safeParse({...p,critical:{...p.critical,waypoints:[point]}}).success,false);
});

test('stepped traces bind every copper width, outer layer, transition and returned ID',()=>{
 const critical={net:'GND',from:{uniqueId:'j',pin:'1'},to:{uniqueId:'u',pin:'9'},waypoints:[[1,0],[2,0]],segments:[{width:1,layer:2},{width:1.5,layer:2},{width:.5,layer:1}],via:{diameter:.9,holeDiameter:.4}};
 const parse=c=>p3Schemas.jlc_eda_route_pcb.safeParse({...target,phase:'critical',critical:c});
 assert(parse(critical).success);
 for(const c of [{...critical,via:undefined},{...critical,segments:critical.segments.slice(1)},{...critical,width:.4},{...critical,via:{diameter:.4,holeDiameter:.4}},{...critical,segments:critical.segments.map(x=>({...x,layer:1}))}])assert.equal(parse(c).success,false);
 const points=[[0,0],[40,0],[80,0],[120,0]],objects=criticalPrimitives(critical,points,'mm').map((x,i)=>({...x,primitiveId:'id'+i}));
 assert.deepEqual(objects.map(x=>x.kind),['Line','Line','Via','Line']);assert.deepEqual([objects[2].x,objects[2].y,objects[3].layer],[80,0,1]);
 const action={critical,points,nativeResult:{log:objects}};
 assert.equal(verifyAddedCopper(action,objects,'mm').status,'matched');
 for(const corrupt of [o=>o[1].lineWidth+=1,o=>o[2].holeDiameter+=1,o=>o[2].x+=1,o=>o[3].layer=2,o=>o.pop()]){
  const changed=structuredClone(objects);corrupt(changed);assert.equal(verifyAddedCopper(action,changed,'mm').status,'mismatch');
 }
});

test('native coalescing proves a full same-width run and keeps every other returned ID',()=>{
 const points=[[0,0],[15,0],[15,12],[15,16],[15,20],[8,27]],critical={net:'GND',segments:points.slice(1).map(()=>({layer:1,width:2}))};
 const raw=criticalPrimitives(critical,points,'mil'),runs=criticalRuns(raw),merged=runs.map(r=>r.object);
 assert.deepEqual(runs.map(r=>r.indices),[[0],[1,2,3],[4]]);
 for(const other of [{...raw[2],net:'X'},{...raw[2],layer:2},{...raw[2],lineWidth:1},{...raw[2],startY:13},{...raw[2],endX:15.01},{...raw[2],endY:11}])assert.equal(criticalRuns([raw[1],other]).length,2);
 const check=(sent,mutate=()=>{})=>{
  const log=sent.map((x,i)=>({...x,primitiveId:'native'+i})),action={critical,points,pathPlan:{objects:sent},beforeNative:{objects:[{primitiveId:'source'}]},nativeResult:{status:'ok',log}};
  const added=[log[0],{...merged[1],startY:20,endY:0,primitiveId:'merged'},log.at(-1)].map(x=>({...x}));
  if(sent===merged)added[1]={...log[1]};
  mutate(action,added);return verifyAddedCopper(action,added,'mil');
 };
 assert.deepEqual(check(raw).criticalReadback.groups[1],{provisional:['native1','native2','native3'],actual:['merged']});assert.equal(check(merged).criticalReadback.validatedCreates,3);
 for(const change of [(a,b)=>b[1].endY=1,(a,b)=>b[1].lineWidth=3,(a,b)=>b[1].net='OTHER',(a,b)=>b[1].primitiveId='native4',(a,b)=>b[1].primitiveId='source',(a,b)=>b[0].primitiveId='replacement',(a,b)=>b.push({...b[1],primitiveId:'extra'}),a=>a.nativeResult.log[2].primitiveId='source',a=>a.nativeResult.log[2].endX=12,a=>a.nativeResult.status='unknown'])assert.equal(check(raw,change).status,'mismatch');
});

test('a second power path can leave a shared pad, but cannot split a recorded same-net centre line',()=>{
 const kinds=['Track','SMD Pad','Via','Board Outline'];
 const spacing={unit:'mm',row:kinds,column:kinds,tables:{1:{status:1,content:kinds.map(()=>kinds.map(()=>.1))}}};
 const record={pcbLayoutBaseline:{plan:{board:{x:0,y:500,width:500,height:500,cornerRadius:10,mountingHoles:[{x:75,y:75,keepoutDiameter:30}]}}},
  pcbRuleBaseline:{config:{Spacing:{'Safe Spacing':{copperThickness1oz:spacing}},Physics:{Track:{copperThickness1oz:{form:{data:{1:{minValue:.1,maxValue:2.54}}}}}}}}};
 const line=(a,b,i)=>({kind:'Line',net:'GND',layer:1,lineWidth:8,startX:a[0],startY:a[1],endX:b[0],endY:b[1],primitiveId:i});
 const native={objects:[line([100,100],[200,200],'old')]},doc={components:[]};
 const check=(a,b)=>checkPlannedCopper([line(a,b,'new')],doc,native,record,{preserveExistingRoutes:true});
 assert.equal(check([100,100],[100,50]).status,'matched');
 for(const [a,b]of [[[100,100],[102,102]],[[180,180],[210,120]],[[100,200],[200,100]],[[200,200],[100,100]]])
  assert(check(a,b).issues.some(i=>i.code==='CRITICAL_EXISTING_TRACE_JUNCTION'));
 assert(check([60,75],[95,75]).issues.some(i=>i.code==='CRITICAL_MOUNTING_HOLE_KEEPOUT'));
});
