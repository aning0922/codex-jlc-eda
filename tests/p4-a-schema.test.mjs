import test from 'node:test';
import assert from 'node:assert/strict';
import {zodToJsonSchema} from 'zod-to-json-schema';
import {p3Schemas} from '../src/p3.mjs';
import {rulesSchema} from '../src/rules.mjs';

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
