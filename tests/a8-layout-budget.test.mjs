import test from 'node:test';import assert from 'node:assert/strict';
import {JlcEdaAdapter} from '../src/adapter.mjs';
import {routingScript,p3Schemas} from '../src/p3.mjs';
import {comparePlacementArchives} from '../src/placement-evidence.mjs';
import {zipSync,strToU8} from 'fflate';
import {planLayout} from '../src/layout.mjs';
import {verifyBoard} from '../src/pcb-validation.mjs';
import {comparePlacedPadDrc} from '../src/drc-comparison.mjs';
import {selectSavedStage} from '../src/saved-stage.mjs';
test('a closed unrouted layout binds the fresh disk design and rejects extra copper, open actions and missing holes',()=>{
 const part={uniqueId:'R1',id:'r',x:20,y:20,layer:1,rotation:0,fixed:false,group:'RC',primitiveLock:false,pins:[],primitiveBounds:{minX:19,minY:19,maxX:21,maxY:21}};
 const document={status:'ok',truncated:false,counts:{components:1},components:[part],documentUuid:'pcb',projectUuid:'readProject'};
 const input={unit:'mil',board:{x:0,y:80,width:80,height:80,layers:4,cornerRadius:5,outlineWidth:.25,mountingHoles:[{x:5,y:5,diameter:2,keepoutDiameter:6}]},edgeClearance:.1,componentClearance:.35,components:[{uniqueId:'R1',x:20,y:20,layer:1,rotation:0,fixed:false,group:'RC'}]};
 const outline={kind:'Polyline',layer:11,primitiveId:'frame',polygon:['R',0,80,80,80,0,5],lineWidth:.25,primitiveLock:true,net:''};
 const hole={kind:'Fill',layer:12,primitiveId:'hole',complexPolygon:['CIRCLE',5,5,1],fillMode:0,primitiveLock:true,net:null};
 const rules={name:'project',config:{}},design={schematic:{sha256:'s'},pcb:{sha256:'p'}};
 const origin={sourcePath:'/placed/work.eprj2',sourceSha256:'saved',sourceJournalSha256:'journal'};
 const reopened={sourcePath:origin.sourcePath,sourceSha256:'saved',sessionId:'inspection',project:{uuid:'readProject'},inspectionCopy:true,freshDiskContext:true,reusedOwnedSession:false};
 const disk={status:'ok',comparison:{status:'matched'},identity:{comparison:{status:'matched'}},persistenceVerified:true,document,design,reopened,
  resourceCleanup:{status:'ok',sessionId:'inspection',sessionNoLongerAlive:true},native:{status:'ok',layers:4,objects:[outline,hole],ruleConfiguration:rules},
  drc:{status:'ok',strict:true,errors:[],beforeRules:rules,afterRules:rules}};
 const source={path:origin.sourcePath,sessionId:'writer',pcbDocumentUuid:'pcb',pcbLayoutBaseline:{plan:planLayout(input,document),outline:[outline]},finish:{
  state:'closed',sourceSha256:'saved',design,disk,closed:{status:'ok',sessionId:'writer',sessionNoLongerAlive:true,editorWindowDestroyed:true}}};
 const chosen=selectSavedStage(source,origin);
 assert.equal(chosen.kind,'closed_unrouted_layout');assert.equal(chosen.sourceProjectUuid,'readProject');
 for(const mutate of [
  s=>s.finish.disk.native.objects.push({kind:'Line',primitiveId:'trace',layer:1,net:'SIG'}),
  s=>s.finish.disk.native.objects.pop(),s=>s.finish.disk.reopened.inspectionCopy=false,
  s=>s.finish.disk.design={...design,pcb:{sha256:'other'}},s=>s.pcbActions={pending:{state:'unknown'}}
 ]){const variant=structuredClone(source);mutate(variant);assert.throws(()=>selectSavedStage(variant,origin),/CONTINUATION_/);}
 const multi=structuredClone(source),first='page1',second='page2',third='page3';
 const pages={[first]:design.schematic,[second]:{sha256:'power-in'}},newSchematic={sha256:'rails'};
 multi.schematicPageUuid=first;multi.continuation={selectedStage:{kind:'closed_routed_layout',design:{schematic:pages[first],schematicPages:pages}}};
 multi.addedSheet={uuid:third,accepted:{newSchematic,pcb:design.pcb}};
 const saved=multi.finish.disk;saved.native.objects.push({kind:'Line',primitiveId:'route',layer:1,net:'SIG'});
 saved.copperCheckpoint={status:'matched'};saved.fullArchive={status:'matched'};
 multi.pcbCopperBaseline={native:structuredClone(saved.native),archives:design};
 multi.finish.design={...design,schematicPages:{...pages,[third]:newSchematic}};saved.design=structuredClone(multi.finish.design);
 assert.equal(selectSavedStage(multi,origin).kind,'closed_routed_layout');
 for(const alter of [m=>delete m.finish.design.schematicPages[second],m=>m.finish.design.schematicPages[second]={sha256:'changed'},m=>m.addedSheet.uuid=first]){
  const changed=structuredClone(multi);alter(changed);changed.finish.disk.design=structuredClone(changed.finish.design);
  assert.throws(()=>selectSavedStage(changed,origin),/CLOSED_SHEETS_UNVERIFIED/);
 }
});
test('disconnected markers follow only a verified native rounding of their own component pose',()=>{
 const doc=x=>({components:[{id:'c',uniqueId:'C1',x,y:5,rotation:0,layer:1,footprint:{uuid:'fp'},pins:[{id:'cp',number:'1',net:'GND',x:x+2,y:5}]}]});
 const errors=x=>[{name:'Connection Error',list:[{name:'GND',list:[{errorType:'Connection Error',net:'GND',pos:{x,y:.5},explanation:{errData:{obj1:'cp',errorType:'No Connection',position:{x,y:.5}}}}]}]}];
 const from=doc(12.34564),to=doc(12.3456),a=errors(1.434564),b=errors(1.434560);
 from.components[0].rotation=270;to.components[0].rotation=-90.00000000000001;
 assert.equal(comparePlacedPadDrc(a,b,from,to).translated,1);assert.equal(comparePlacedPadDrc(a,errors(1.434559),from,to).status,'mismatch');
 to.components[0].pins[0].net='other';assert.equal(comparePlacedPadDrc(a,b,from,to).status,'mismatch');
});

test('four-layer placement checks every envelope against rounded corners and screw keepouts',()=>{
 const parts=Array.from({length:43},(_,i)=>({uniqueId:'R'+i,x:10+(i%9)*6,y:15+Math.floor(i/9)*6,layer:1,rotation:0,fixed:false,group:'RC'}));
 const doc={status:'ok',counts:{components:43},truncated:false,components:parts.map(p=>({...p,id:p.uniqueId,primitiveBounds:{minX:p.x-.2,minY:p.y-.2,maxX:p.x+.2,maxY:p.y+.2},pins:[]}))};
 const input={unit:'mil',board:{x:0,y:80,width:80,height:80,layers:4,cornerRadius:5,outlineWidth:.25,mountingHoles:[{x:5,y:5,diameter:2,keepoutDiameter:6}]},edgeClearance:.1,componentClearance:.35,components:parts};
 const plan=planLayout(input,doc);assert.equal(plan.status,'ok');
 const outline={kind:'Polyline',layer:11,primitiveId:'frame',polygon:['R',0,80,80,80,0,5],lineWidth:.25,primitiveLock:true,net:''};
 const hole={kind:'Fill',layer:12,primitiveId:'hole',complexPolygon:['CIRCLE',5,5,1],fillMode:0,primitiveLock:true,net:null};
 const read=holes=>verifyBoard(plan,{status:'ok',layers:4,objects:[outline,...holes]});assert.equal(read([hole]).status,'matched');
 for(const holes of [[],[hole,hole],[{...hole,complexPolygon:['CIRCLE',5.1,5,1]}],[{...hole,net:'GND'}]])assert.equal(read(holes).status,'mismatch');
 assert.equal(verifyBoard(plan,{status:'ok',layers:2,objects:[outline,hole]}).status,'mismatch');
 for(const [x,y,error]of [[6,5,'LAYOUT_MOUNTING_HOLE_OVERLAP'],[.5,79.5,'LAYOUT_OUTSIDE_BOARD_MARGIN']]){
  const bad=structuredClone(input);Object.assign(bad.components[0],{x,y});assert(planLayout(bad,doc).issues.some(e=>e.code===error));
 }
});
test('only the declared mechanical cuts and inactive palette conversions are allowed in a four-layer placement',()=>{
 const f=fixture(),layer={type:'LAYER',id:'["LAYER",24]',body:{layerId:24,use:false,show:false,inactiveColor:'#a.492f'}};
 f.rows.splice(1,0,layer);const rows=structuredClone(f.rows);rows[1].body.inactiveColor='#0a492f';
 const hole={type:'FILL',id:'h',body:{layerId:12,path:[['CIRCLE',5,5,1]],netName:'',fillStyle:'SOLID',locked:true}};
 rows.splice(2,0,hole);const run=()=>comparePlacementArchives({pcbData:pack(f.rows),schematic:{}},{pcbData:pack(rows),schematic:{}},{documentUuid:'pcb',beforeDocument:f.document,afterDocument:f.document,mountingIds:['h'],fourLayerChange:true});
 assert.equal(run().status,'matched');hole.body.netName='GND';assert.equal(run().status,'mismatch');hole.body.netName='';rows[1].body.inactiveColor='#ffffff';assert.equal(run().status,'mismatch');
});
test('long native budget is explicit and bounded while ordinary reads keep short defaults',async()=>{
 const calls=[],a=new JlcEdaAdapter({executable:'/official',runner:async(exe,args,options)=>{calls.push({args,timeout:options.timeoutMs});return {value:{status:'ok'}};}});
 await a.invoke('s','({status:"ok"})');await a.invoke('s','({status:"ok"})',120000);await a.invoke('s','({status:"ok"})',180000);
 assert.deepEqual(calls.map(c=>c.args[c.args.indexOf('--timeout')+1]),['15000','120000','180000']);assert.deepEqual(calls.map(c=>c.timeout),[18000,123000,183000]);
 for(const n of [0,180001,NaN,Infinity,1.5])await assert.rejects(a.invoke('s','x',n),e=>e.code==='INVOKE_BUDGET_OUT_OF_RANGE');assert.equal(calls.length,3);
});
const pack=rows=>Buffer.from(zipSync({'m.epru':strToU8(rows.map(r=>JSON.stringify({type:r.type,id:r.id})+'||'+JSON.stringify(r.body)+'|').join('\n'))})).toString('base64');
function fixture(){const rows=[{type:'DOCHEAD',body:{uuid:'pcb',docType:'PCB'}},{type:'RULE',id:'rule',body:{enabled:true}},{type:'COMPONENT',id:'c',body:{x:0,y:0,angle:0,locked:false,layerId:1,attrs:{'Unique ID':'R1'}}},{type:'ATTR',id:'attr',body:{parentId:'c',x:0,y:1,angle:0,align:1,value:'R1'}},{type:'DOCHEAD',body:{uuid:'fp',docType:'FOOTPRINT'}},{type:'PAD',id:'pad',body:{num:'1',width:5}}];const document={components:[{id:'c',uniqueId:'R1',x:0,y:0,rotation:0,primitiveLock:false}]};return {rows,document};}
test('placement permits declared poses/attached text while rejecting models, rules, values, copper and locked moves',()=>{
 const f=fixture(),before={pcbData:pack(f.rows),schematic:{sha256:'s'}},afterRows=structuredClone(f.rows),afterDoc=structuredClone(f.document);afterRows[2].body.x=10;afterRows[3].body.x=10;afterDoc.components[0].x=10;
 const run=()=>comparePlacementArchives(before,{pcbData:pack(afterRows),schematic:{sha256:'s'}},{documentUuid:'pcb',beforeDocument:f.document,afterDocument:afterDoc,strategy:'auto_candidate'});
 assert.equal(run().status,'matched');afterRows[1].body.enabled=false;assert.equal(run().status,'mismatch');afterRows[1].body.enabled=true;
 afterRows[5].body.width=6;assert.equal(run().status,'mismatch');afterRows[5].body.width=5;
 afterRows[3].body.value='R2';assert.equal(run().status,'mismatch');afterRows[3].body.value='R1';
 f.document.components[0].primitiveLock=true;assert.equal(run().status,'mismatch');f.document.components[0].primitiveLock=false;
 afterRows.splice(4,0,{type:'LINE',id:'extra',body:{netName:'IN'}});assert.equal(run().status,'mismatch');
});
test('native autoLayout checks the exact component snapshot before invoking and reports the native result separately',async()=>{
 let invoked=0;const c={id:'c',uniqueId:'R1',x:1,y:2,rotation:0,primitiveLock:false};
 const native=Object.fromEntries(Object.entries({PrimitiveId:'c',UniqueId:'R1',X:1,Y:2,Rotation:0,PrimitiveLock:false}).map(([k,v])=>['getState_'+k,()=>v]));
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'p',data:[{itemType:'Board',pcb:{uuid:'pcb'},schematic:{uuid:'sch',page:[{uuid:'page'}]}}]})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'pcb',parentProjectUuid:'p',documentType:3})},pcb_PrimitiveComponent:{getAll:async()=>[native]},pcb_Document:{autoLayout:async()=>{invoked++;return {success:true,totalComponentsCount:1,successComponentsCount:1,failedComponents:[],duration:1};}}};
 const p={expectedProjectUuid:'p',pcbDocumentUuid:'pcb',schematicUuid:'sch',schematicPageUuid:'page',operation:'auto_layout',beforeComponents:[c]};const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor,run=()=>new AsyncFunction('eda','return await '+routingScript(p))(eda);
 assert.equal((await run()).nativeResult.success,true);assert.equal(invoked,1);c.x=2;assert.equal((await run()).code,'AUTO_LAYOUT_SCOPE_CHANGED');assert.equal(invoked,1);
});
test('native dictionary reordering and null-position hidden attributes preserve all semantic fields',()=>{
 const f=fixture();f.rows[2].body.attrs={Name:'R','Unique ID':'R1'};f.rows[3].body.x=null;f.rows[3].body.y=null;
 const rows=structuredClone(f.rows);rows[2].body.attrs={'Unique ID':'R1',Name:'R'};rows[2].body.angle=270;rows[3].body.angle=-90;
 const doc=structuredClone(f.document);doc.components[0].rotation=270;
 const run=()=>comparePlacementArchives({pcbData:pack(f.rows),schematic:{}},{pcbData:pack(rows),schematic:{}},{documentUuid:'pcb',beforeDocument:f.document,afterDocument:doc});
 assert.equal(run().status,'matched');rows[2].body.attrs.Name='changed';assert.equal(run().status,'mismatch');
});
import {compareRouteArchives} from '../src/route-archive-evidence.mjs';
test('route full archive binds added geometry and rejects changes to original copper, rules and models',()=>{
 const f=fixture(),line={type:'LINE',id:'new',body:{startX:1,startY:2,endX:3,endY:4,width:10,netName:'OUT',layerId:1,locked:true}},rows=structuredClone(f.rows);rows.splice(4,0,line);
 const before={pcbData:pack(f.rows),schematic:{sha256:'s'}},added=[{kind:'Line',primitiveId:'new',startX:1,startY:2,endX:3,endY:4,lineWidth:10,net:'OUT',layer:1,primitiveLock:true}];
 const run=()=>compareRouteArchives(before,{pcbData:pack(rows),schematic:{sha256:'s'}},{documentUuid:'pcb',added});
 assert.equal(run().status,'matched');line.body.netName='IN';assert.equal(run().status,'mismatch');line.body.netName='OUT';rows[1].body.enabled=false;assert.equal(run().status,'mismatch');
});
test('native route forwards the installed RoutingNets mapping and keep enums unchanged',async()=>{
 let received;const props={RoutingNets:['IN','OUT','GND'],ignoreNets:[],layers:[1,2],existingPrimitiveMode:'keep',cornerStyle:0,optimization:0};
 const eda={dmt_Project:{getCurrentProjectInfo:async()=>({uuid:'p',data:[{itemType:'Board',pcb:{uuid:'pcb'},schematic:{uuid:'sch',page:[{uuid:'page'}]}}]})},dmt_SelectControl:{getCurrentDocumentInfo:async()=>({uuid:'pcb',parentProjectUuid:'p',documentType:3})},pcb_Document:{autoRouting:async p=>{received=p;return {success:true,totalNetsCount:3,successNetsCount:0,failedNets:['IN','OUT','GND'],duration:1};}}};
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;const result=await new AsyncFunction('eda','return await '+routingScript({expectedProjectUuid:'p',schematicUuid:'sch',schematicPageUuid:'page',pcbDocumentUuid:'pcb',operation:'route',props}))(eda);
 assert.deepEqual(received,props);assert.equal(result.nativeResult.successNetsCount,0);assert.equal(result.nativeResult.failedNets.length,3);
});
test('new conversion placeholders are bounded and cannot conceal a geometry or schema change',()=>{
 const f=fixture(),line={type:'LINE',id:'new',body:{startX:1,startY:2,endX:3,endY:4,width:10,netName:'OUT',layerId:1,locked:true}},placeholder={type:'ELE_PLACEHOLDER',id:'placeholder1',body:{dataType:'LINE',max:1}},rows=structuredClone(f.rows);rows.splice(4,0,line,placeholder);
 const before={pcbData:pack(f.rows),schematic:{}},added=[{kind:'Line',primitiveId:'new',startX:1,startY:2,endX:3,endY:4,lineWidth:10,net:'OUT',layer:1,primitiveLock:true}];
 const run=()=>compareRouteArchives(before,{pcbData:pack(rows),schematic:{}},{documentUuid:'pcb',added});
 assert.equal(run().status,'matched');placeholder.body.max=2;assert.equal(run().status,'mismatch');placeholder.body.max=1;placeholder.body.hiddenGeometry=1;assert.equal(run().status,'mismatch');delete placeholder.body.hiddenGeometry;placeholder.body.dataType='PAD';assert.equal(run().status,'mismatch');
});
import {controlledLayout} from '../src/layout-candidate.mjs';import {fingerprint} from '../src/drawing.mjs';import {archiveDesignFingerprint} from '../src/resources.mjs';import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
test('unknown candidate observations never replay autoLayout and changed request IDs/modes cannot bypass it',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'a8-candidate-'));try{
  const f=fixture(),data=pack(f.rows),archives={pcbData:data,pcb:archiveDesignFingerprint(data),schematic:archiveDesignFingerprint(data)};
  const layout={unit:'mil',board:{x:-20,y:20,width:40,height:40,layers:2,outlineWidth:1},edgeClearance:0,componentClearance:0,components:[{uniqueId:'R1',x:0,y:0,rotation:0,layer:1,fixed:false,group:'test'}],distanceConstraints:[]};
  const p={sessionId:'s',expectedProjectUuid:'p',schematicPageUuid:'page',schematicUuid:'sch',pcbDocumentUuid:'pcb',workDirectory:dir,requestId:'candidate',layout,strategy:'auto_candidate',phase:'apply'};
  const doc={status:'ok',truncated:false,counts:{components:1},components:[{...f.document.components[0],layer:1,primitiveBounds:{minX:-1,maxX:1,minY:-1,maxY:1},pins:[]}]};
  const old={hash:fingerprint({layout,strategy:p.strategy}),strategy:p.strategy,state:'unknown',beforeArchives:archives,beforeDocument:doc,beforeOutline:[],plan:{board:layout.board}};
  const ctx={dir,r:{pcbActions:{'layout/candidate':old},pcbLayoutBaseline:{plan:{board:layout.board},outline:[]}}};let engines=0;
  const a={jlc_eda_read_document:async()=>doc,invokeLossless:async()=>({status:'ok',objects:[],layers:2}),invoke:async(s,code)=>{if(code.includes('"operation":"auto_layout"'))engines++;return code.includes('"operation":"archive"')?{status:'ok',data}:{status:'ok'};}};
  assert.equal((await controlledLayout(a,p,ctx)).status,'unknown');assert.equal((await controlledLayout(a,p,ctx)).status,'unknown');
  assert.equal((await controlledLayout(a,{...p,requestId:'other'},ctx)).code,'LAYOUT_KNOWN_BASELINE_REQUIRED');
  assert.equal((await controlledLayout(a,{...p,strategy:'adjust'},ctx)).code,'REQUEST_CONFLICT');assert.equal(engines,0);
 }finally{await rm(dir,{recursive:true,force:true});}
});
