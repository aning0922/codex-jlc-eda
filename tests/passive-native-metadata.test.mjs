import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync}from'node:fs';import{zipSync,strToU8}from'fflate';
import{managerViewChanges,managerViewRestorations,passivePresentationFingerprint}from'../src/passive-native-metadata.mjs';import{preserveArchive}from'../src/eco-preservation.mjs';
const f=JSON.parse(readFileSync(new URL('./fixtures/synthetic-footprint-preview.json',import.meta.url))),uuid=f.before.uuid;
const archive=docs=>Buffer.from(zipSync({'design.epru':strToU8(docs.map(d=>[{type:'DOCHEAD',id:d.uuid,body:{uuid:d.uuid,docType:d.docType}},...d.rows].map((r,i)=>JSON.stringify({type:r.type,id:r.id,ticket:i})+'||'+JSON.stringify(r.body)+'|').join('\n')).join('\n'))})).toString('base64');
const before=archive([f.before]),after=archive([f.after]),known=managerViewChanges(before,after,[uuid]);
const check=data=>preserveArchive(before,data,{modelViewChanges:managerViewChanges(before,data,[uuid])});
test('synthetic retained footprint: exact 13 native initialization rows, all original records preserved',()=>{assert.equal(known.length,13);assert.equal(known.filter(p=>p.type==='NET').length,1);assert.equal(check(after).status,'matched');assert.equal(check(after).exactPreservedRecords,f.before.rows.length);assert.ok(known.every(p=>p.modelSource&&p.modelAnchor));assert.equal(managerViewChanges(before,after,['wrong']).length,0);});
const mutations={
 'extra display field':d=>d.rows.find(r=>r.id==='["PRIMITIVE","DRC"]').body.pick=true,
 'unknown display enum':d=>d.rows.find(r=>r.id==='["PRIMITIVE","ALL"]').body.layerId=1,
 'extra record':d=>d.rows.push({type:'PRIMITIVE',id:'["PRIMITIVE","OTHER"]',body:{display:true}}),
 'duplicate initialized row':d=>d.rows.push(structuredClone(d.rows.find(r=>r.type==='NET'))),
 'wrong document type':d=>d.docType='PCB',
 'changed model source':d=>d.rows.find(r=>r.type==='META').body.source='0'.repeat(32)+'|'+'1'.repeat(32),
 'nonempty net name':d=>d.rows.find(r=>r.type==='NET').id='["NET","GND"]',
 'net class':d=>d.rows.find(r=>r.type==='NET').body.netType='POWER',
 'differential pair':d=>d.rows.find(r=>r.type==='NET').body.differentialName='PAIR',
 'positive differential':d=>d.rows.find(r=>r.type==='NET').body.isPositiveNet=true,
 'length group':d=>d.rows.find(r=>r.type==='NET').body.equalLengthGroupName='BUS',
 'net extra field':d=>d.rows.find(r=>r.type==='NET').body.net='GND',
 'ratline changed':d=>d.rows.find(r=>r.type==='NET').body.retLine=false,
 'pad geometry':d=>d.rows.find(r=>r.type==='PAD').body.defaultPad.width+=.001,
 'pad mapping':d=>d.rows.push({type:'PAD_NET',id:'["PAD_NET","c","1","p"]',body:{padNet:'GND'}}),
 'origin':d=>d.rows.find(r=>r.type==='CANVAS').body.originX=1,
 'rule addition':d=>d.rows.push({type:'RULE',id:'rule',body:{clearance:1}}),
 'old record removed':d=>d.rows.splice(d.rows.findIndex(r=>r.type==='PAD'),1),
};
for(const[name,mutate]of Object.entries(mutations))test('native defaults reject '+name,()=>{const d=structuredClone(f.after);mutate(d);assert.equal(check(archive([d])).status,'mismatch');const actual=passivePresentationFingerprint(archive([d]),known),base=passivePresentationFingerprint(before,known);assert.ok(actual.status==='mismatch'||actual.sha256!==base.sha256);});
test('same defaults on non-target model are not adopted',()=>{const a=structuredClone(f.before),b=structuredClone(f.after);a.uuid=b.uuid='other';const x=archive([f.before,a]),y=archive([f.after,b]);assert.equal(preserveArchive(x,y,{modelViewChanges:managerViewChanges(x,y,[uuid])}).status,'mismatch');});
test('registered defaults restore exactly, retain strict raw archive proof and canonical comparison',()=>{const restore=managerViewRestorations(after,before,known);assert.equal(restore.length,13);assert.equal(preserveArchive(after,before,{modelViewChanges:restore}).status,'matched');assert.equal(passivePresentationFingerprint(after,known).sha256,passivePresentationFingerprint(before,known).sha256);const d=structuredClone(f.after);d.rows=d.rows.filter(r=>r.type!=='NET');assert.equal(managerViewRestorations(after,archive([d]),known).length,1);assert.equal(passivePresentationFingerprint(archive([d]),known).sha256,passivePresentationFingerprint(before,known).sha256);});
test('non-exact restoration and forged registration fail closed',()=>{const d=structuredClone(f.after);d.rows.find(r=>r.type==='NET').body.specialColor='#ffffff';assert.equal(managerViewRestorations(after,archive([d]),known).length,0);assert.equal(passivePresentationFingerprint(archive([d]),known).status,'mismatch');const forged=structuredClone(known);forged[0].after.specialColor='#ffffff';assert.equal(passivePresentationFingerprint(after,forged).status,'mismatch');assert.equal(passivePresentationFingerprint(archive([]),known).status,'mismatch');});
test('old two preview-filter forms and exact restoration remain supported',()=>{const a=structuredClone(f.before);a.rows.push({type:'PRIMITIVE',id:'["PRIMITIVE","ALL"]',body:{layerId:0,display:true,color:null}});const b=structuredClone(a);b.rows.at(-1).body={layerId:56,display:false,color:null};b.rows.push({type:'PRIMITIVE',id:'["PRIMITIVE","PROPERTY"]',body:{layerId:0,display:false,color:null}});const x=archive([a]),y=archive([b]),changes=managerViewChanges(x,y,[uuid]);assert.equal(changes.length,2);assert.equal(preserveArchive(x,y,{modelViewChanges:changes}).status,'matched');assert.equal(managerViewRestorations(y,x,changes).length,2);assert.equal(passivePresentationFingerprint(x,changes).sha256,passivePresentationFingerprint(y,changes).sha256);});
