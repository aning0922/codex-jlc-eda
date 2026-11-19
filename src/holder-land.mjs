import path from 'node:path';
import {mkdir,readFile,writeFile,realpath,rename} from 'node:fs/promises';
import {isDeepStrictEqual as equal} from 'node:util';
import {unzipSync,zipSync,strFromU8,strToU8} from 'fflate';
import {digest} from './facts.mjs';
import {drawingScript,fingerprint} from './drawing.mjs';
import {pcbScript} from './pcb.mjs';
import {scripts} from './native-scripts.mjs';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {archiveDesignFingerprint,withFreshRead} from './resources.mjs';
import {importLocalProject} from './project-import.mjs';
import {manufactureScript} from './manufacturing.mjs';
import {parseCam} from './manufacturing-files.mjs';
import {camGeometry} from './manufacturing-geometry.mjs';
import {crystalLandPlan,crystalBoardCopper,verifyCrystalCam} from './crystal-land.mjs';

const need=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'unknown'});};
const mm=.0254,near=(a,b,t=.005)=>Math.abs(a-b)<t;
const readJson=name=>readFile(name,'utf8').then(JSON.parse);
async function writeJson(name,value){await writeFile(name+'.tmp',JSON.stringify(value)+'\n');await rename(name+'.tmp',name);}

export function holderLandPlan(data,components,ref){
  const c=components.find(v=>v.uniqueId===ref);
  need(c&&c.designator===ref&&c.supplierId==='C5377561'&&c.manufacturerPart==='BS08A3B0J001-TP'&&
    c.rotation===0&&c.layer===1&&components.filter(v=>v.footprint.uuid===c.footprint.uuid).length===1,'HOLDER_LAND_UNIQUE_INSTANCE_REQUIRED');
  const model=nativeModelRecords(data).get(c.footprint.uuid),meta=model?.rows.filter(r=>r.type==='META');
  need(model?.docType==='FOOTPRINT'&&meta.length===1&&meta[0].body.source==='2dd9463ac7dc49cb95299c9c9e798fbe|0819f05c4eef4c71ace90d822a990e87','HOLDER_LAND_MODEL_BINDING');
  const pads=model.rows.filter(r=>r.type==='PAD').sort((a,b)=>a.body.num.localeCompare(b.body.num));
  need(pads.length===2&&pads[0].body.num==='1'&&pads[1].body.num==='2','HOLDER_LAND_PAD_NUMBERS');
  const [one,two]=pads.map(p=>p.body);
  need(pads.every(({id,body:p})=>p.layerId===1&&p.hole===null&&!p.specialPad?.length&&p.defaultPad.padType==='RECT'&&p.defaultPad.radius===0&&
    c.pins.some(v=>v.id===c.id+id&&v.number===p.num&&v.net===(p.num==='1'?'GND':'VBAT_CELL')))&&
    two.padAngle===180&&near(one.defaultPad.width*mm,4.5)&&near(one.defaultPad.height*mm,2.4)&&near(two.defaultPad.width*mm,3.05)&&
    near(two.defaultPad.height*mm,3.4)&&near((two.centerX+two.padOffsetX-one.centerX-one.padOffsetX)*mm,21.175),'HOLDER_LAND_ORIGINAL_GEOMETRY');
  const hx=two.defaultPad.width/2,hy=two.defaultPad.height/2,r=1.3/mm;
  // Custom pad paths use footprint coordinates, including the original copper offset.
  const x=two.centerX+two.padOffsetX,y=two.centerY+two.padOffsetY;
  const left=x-hx,right=x+hx,top=y+hy,bottom=y-hy;
  const contour=[left,top,'L',right-r,top,'ARC',-90,right,top-r,'L',right,bottom+r,'ARC',-90,right-r,bottom,'L',left,bottom,left,top];
  return {ref,modelUuid:model.uuid,padId:pads[1].id,componentId:c.id,before:two,after:{...two,defaultPad:{padType:'POLYGON',path:contour}},
    radiusMm:1.3,widthMm:2*hx*mm,heightMm:2*hy*mm,endFlatMm:2*hy*mm-2.6,outerDirection:'footprint +X',source:meta[0].body.source};
}

export function checkHolderCopper(plan,component,pin){
  const p=pin?.padShape?.[1],x=component.x+plan.before.centerX+plan.before.padOffsetX,y=component.y+plan.before.centerY+plan.before.padOffsetY;
  const w=plan.widthMm/mm,h=plan.heightMm/mm,r=1.3/mm,l=x-w/2,b=y-h/2,t=y+h/2,right=x+w/2;
  const wanted=[l,t,'L',right-r,t,'ARC',-90,right,t-r,'L',right,b+r,'ARC',-90,right-r,b,'L',l,b,l,t];
  need(pin?.padShape?.[0]==='POLYGON'&&Array.isArray(p)&&p.length===wanted.length&&
    near(pin.x,x,.06)&&near(pin.y,y,.06)&&wanted.every((v,i)=>typeof v==='number'?near(p[i],v,.002):v===p[i]),'HOLDER_BOARD_CONTOUR_MISMATCH');
  return {centerMm:[x*mm,y*mm],widthMm:w*mm,heightMm:h*mm,outerRadiiMm:[(p[7]-p[3])*mm,(p[10]-p[14])*mm],outerFlatMm:(p[8]-p[11])*mm};
}

async function exportLandCam(a,t,file){
  const v=await a.invokeLossless(t.sessionId,manufactureScript({...t,kind:'gerber'}),60000);
  need(v.status==='ok'&&v.data,'HOLDER_CAM_CAPTURE_FAILED');const bytes=Buffer.from(v.data,'base64');
  await writeFile(file,bytes);return digest(bytes);
}

export function verifyHolderCam(beforeBytes,afterBytes,copper){
  const [before,after]=[beforeBytes,afterBytes].map(unzip=>unzipSync(unzip));
  const drills=files=>Object.keys(files).filter(k=>/\.drl$/i.test(k)).sort();
  const drillFiles=drills(before),[x,y]=copper.centerMm,w=copper.widthMm,h=copper.heightMm;
  need(drillFiles.length&&equal(drillFiles,drills(after)),'HOLDER_DRILL_LAYERS_CHANGED');
  let holeCount=0;
  for(const name of drillFiles){
    const program=f=>strFromU8(f[name]).split(/\r?\n/).filter(l=>!l.startsWith(';')).join('\n');
    need(program(before)===program(after),'HOLDER_DRILL_PROGRAM_CHANGED');
    const parsed=parseCam(strFromU8(after[name])),geometry=camGeometry(parsed);
    need(parsed.done&&parsed.units==='mm'&&geometry.complete&&geometry.shapes.every(s=>s.kind==='circle'&&
      (Math.abs(s.x-x)>w/2+s.r||Math.abs(s.y-y)>h/2+s.r)),'HOLDER_PHYSICAL_DRILL_UNCONFIRMED');
    holeCount+=geometry.shapes.length;
  }
  const top=f=>{const keys=Object.keys(f).filter(k=>/\.gtl$/i.test(k));need(keys.length===1,'HOLDER_TOP_COPPER_MISSING');
    const v=parseCam(strFromU8(f[keys[0]]));need(v.done&&v.units==='mm','HOLDER_TOP_COPPER_FORMAT');return v;};
  const source=camGeometry(top(before)).shapes.filter(s=>s.kind==='rect'&&near(s.x,x,.001)&&near(s.y,y,.001)&&near(s.w,w,.001)&&near(s.h,h,.001));
  need(source.length===1,'HOLDER_SOURCE_CAM_RECTANGLE');
  const regions=[];let region=null,mode;
  for(const c of top(after).commands){
    if(c.type==='set'&&c.prop==='mode')mode=c.value;
    if(c.type==='set'&&c.prop==='region'){if(c.value)region=[];else if(region){regions.push(region);region=null;}}
    if(region&&c.type==='op')region.push({mode,op:c.op,...c.coord});
  }
  const l=x-w/2,t=y+h/2,b=y-h/2,right=x+w/2,r=1.3;
  const expected=[['i',l,t],['i',right-r,t],['cw',right,t-r,0,-r],['i',right,b+r],
    ['cw',right-r,b,-r,0],['i',l,b],['i',l,t]];
  const matches=regions.filter(rows=>rows.length===expected.length&&rows.every((p,i)=>{
    const [m,px,py,ix,iy]=expected[i];
    return p.op===(i?'int':'move')&&p.mode===m&&near(p.x,px,.00003)&&near(p.y,py,.00003)&&
      (m!=='cw'||near(p.i,ix,.00003)&&near(p.j,iy,.00003));
  }));
  need(matches.length===1,'HOLDER_CAM_OUTLINE_MISMATCH');
  return {sourceCenterMm:[source[0].x,source[0].y],region:matches[0],drillFiles,holeCount,unchangedDrillProgram:true,drillHitsInLand:0};
}

// Keep every other native line and every other exchange member byte-for-byte.
export function patchHolderArchive(bytes,plan,required=true){
  const files=unzipSync(bytes),edits=new Map((plan.pads??[plan]).map(p=>[p.padId,p])),seen=new Set();
  for(const name of Object.keys(files).filter(n=>n.endsWith('.epru'))){
    let current=null,changed=false;
    const lines=strFromU8(files[name]).split('\n').map(line=>{
      if(!line.trim())return line;
      const sep=line.indexOf('||');need(sep>=0,'HOLDER_EXCHANGE_FORMAT');
      const h=JSON.parse(line.slice(0,sep));
      if(h.type!=='DOCHEAD'&&!(current===plan.modelUuid&&h.type==='PAD'&&edits.has(h.id)))return line;
      const raw=line.slice(sep+2).replace(/\r$/,'').replace(/\|$/,'');const body=JSON.parse(raw);
      if(h.type==='DOCHEAD'){current=body.docType==='FOOTPRINT'?body.uuid:null;return line;}
      const edit=edits.get(h.id);need(!seen.has(h.id)&&equal(body,edit.before),'LAND_INPUT_CHANGED');
      changed=true;seen.add(h.id);
      return line.slice(0,sep+2)+JSON.stringify(edit.after)+'|'+(line.endsWith('\r')?'\r':'');
    });
    if(changed)files[name]=strToU8(lines.join('\n'));
  }
  need(seen.size===edits.size||(!required&&!seen.size),'LAND_EXCHANGE_TARGET_COUNT');
  return seen.size?Buffer.from(zipSync(files)):Buffer.from(bytes);
}

async function archives(a,t){
  const result={};
  for(const [kind,uuid,script] of [['schematic',t.schematicPageUuid,drawingScript],['pcb',t.pcbDocumentUuid,pcbScript]]){
    const f=await a.invoke(t.sessionId,scripts.focus({...t,kind,documentUuid:uuid}));need(f.status==='ok','HOLDER_READ_FOCUS');
    const v=await a.invoke(t.sessionId,script({...t,operation:'archive'}));need(v.status==='ok'&&v.data,v.code??'HOLDER_NATIVE_ARCHIVE');result[kind]=v.data;
  }
  return result;
}
function target(o){
  need(o.status==='ok'&&o.inspectionCopy&&o.freshDiskContext&&o.boards.length===1&&o.boards[0].schematicPageUuids.length===1,'HOLDER_INSPECTION_SCOPE');
  const b=o.boards[0];return {sessionId:o.sessionId,expectedProjectUuid:o.project.uuid,schematicUuid:b.schematicUuid,schematicPageUuid:b.schematicPageUuids[0],pcbDocumentUuid:b.pcbDocumentUuid};
}
async function exportExchange(uuid){
  if((await eda.dmt_Project.getCurrentProjectInfo())?.uuid!==uuid)return {status:'failed'};
  const f=await eda.sys_FileManager.getProjectFile('holder-land',undefined,'epro2');
  if(!f||!f.size||f.size>8*1024*1024)return {status:'failed'};
  let s='';for(const b of new Uint8Array(await f.arrayBuffer()))s+=String.fromCharCode(b);
  return (await eda.dmt_Project.getCurrentProjectInfo())?.uuid===uuid?{status:'ok',data:btoa(s)}:{status:'failed'};
}
export async function prepareLandCopy(a,p,source,history){
  const crystal=!!p.bootReset;
  const binding={source,sourceSha256:digest(await readFile(source)),checkpoint:await realpath(p.sourceCheckpointPath),checkpointSha256:digest(await readFile(p.sourceCheckpointPath)),
    output:path.resolve(p.outputDirectory),requestId:p.requestId,ref:crystal?p.bootReset.crystal:p.lse.holder,contour:crystal?'SSP-T7-F-0.300mm':'footprint-right-R1.3'};
  const dir=path.join(path.dirname(binding.output),'.jlc-footprint-preparation',fingerprint(binding));
  await mkdir(dir,{recursive:true});const proofPath=path.join(dir,'proof.json'),inputPath=path.join(dir,'inputs.json');
  const optional=name=>readJson(name).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
  const known=await optional(proofPath);
  const withCam=async proof=>{
    const original=await readFile(path.join(dir,'copper-before.zip')),after=await readFile(path.join(dir,'copper-after.zip'));
    need(digest(original)===proof.camBefore&&digest(after)===proof.camAfter,'HOLDER_CAPTURE_CHANGED');
    proof.cam=(crystal?verifyCrystalCam:verifyHolderCam)(original,after,proof.copper);await writeJson(proofPath,proof);return proof;
  };
  if(known){need(equal(known.binding,binding)&&digest(await readFile(known.path))===known.fileSha256,'HOLDER_PREPARED_FILE_CHANGED');return withCam(known);}
  const prepared=await withFreshRead(a,source,async o=>{
    const t=target(o);need(o.sourceSha256===binding.sourceSha256,'HOLDER_SOURCE_CHANGED');
    let frozen=await optional(inputPath);const file=path.join(dir,crystal?'crystal-gap.epro2':'rounded.epro2');
    if(!frozen){
      const doc=await a.jlc_eda_read_document({...t,kind:'pcb',documentUuid:t.pcbDocumentUuid,includePins:true,includeGeometry:true,limit:200});
      need(doc.status==='ok'&&!doc.truncated,'HOLDER_BOARD_UNCONFIRMED');
      const data=await archives(a,t),plan=(crystal?crystalLandPlan:holderLandPlan)(data.pcb,doc.components,binding.ref),design={};
      for(const [kind,raw] of Object.entries(data)){
        need(equal(archiveDesignFingerprint(raw),history.finish.design[kind]),'HOLDER_CLOSED_SOURCE_ARCHIVE_CHANGED');
        const patched=patchHolderArchive(Buffer.from(raw,'base64'),plan,kind==='pcb');design[kind]=archiveDesignFingerprint(patched.toString('base64'));
      }
      const camBefore=await exportLandCam(a,t,path.join(dir,'copper-before.zip'));
      const ex=await a.invokeLossless(t.sessionId,'('+exportExchange.toString()+')('+JSON.stringify(t.expectedProjectUuid)+')',60000);
      need(ex.status==='ok'&&ex.data,'HOLDER_EXCHANGE_EXPORT');
      const original=Buffer.from(ex.data,'base64'),patched=patchHolderArchive(original,plan);
      await writeFile(file,patched);frozen={binding,plan,design,camBefore,exchangeSha256:digest(patched),originalExchangeSha256:digest(original)};await writeJson(inputPath,frozen);
    }
    need(equal(binding,frozen.binding)&&digest(await readFile(file))===frozen.exchangeSha256,'HOLDER_PREPARATION_CONFLICT');
    const importDir=path.join(dir,'import'),last=await optional(path.join(importDir,'project-import.json'));
    let imported;
    if(last){need(last.state==='completed'&&last.source===file&&last.sourceSha256===frozen.exchangeSha256&&digest(await readFile(last.path))===last.outputSha256,'HOLDER_RETAINED_IMPORT');imported=last.result;}
    else imported=await importLocalProject(a,{outputDirectory:importDir,requestId:p.requestId+'-land',projectImport:{sourcePath:file,sessionId:t.sessionId,expectedProjectUuid:t.expectedProjectUuid}});
    need(imported.status==='ok'&&imported.importOnly&&imported.readback?.resourceCleanup?.status==='ok','HOLDER_OFFICIAL_IMPORT_UNCONFIRMED');
    return {status:'ok',frozen,file:imported.path,hash:imported.outputSha256};
  });
  need(prepared.status==='ok'&&prepared.resourceCleanup?.status==='ok',prepared.code??'HOLDER_SOURCE_INSPECTION');
  const check=await withFreshRead(a,prepared.file,async o=>{
    const t=target(o),data=await archives(a,t);need(o.sourceSha256===prepared.hash,'HOLDER_IMPORTED_FILE_CHANGED');
    const design=Object.fromEntries(Object.entries(data).map(([k,v])=>[k,archiveDesignFingerprint(v)]));
    need(equal(design,prepared.frozen.design),'HOLDER_IMPORTED_NON_TARGET_CHANGED');
    const doc=await a.jlc_eda_read_document({...t,kind:'pcb',documentUuid:t.pcbDocumentUuid,includePins:true,includeGeometry:true,limit:200}),plan=prepared.frozen.plan;
    const part=doc.components?.find(c=>c.uniqueId===plan.ref&&c.id===plan.componentId&&c.footprint.uuid===plan.modelUuid);
    need(doc.status==='ok'&&part,'LAND_IMPORTED_INSTANCE_MISSING');
    const pin=crystal?undefined:part.pins.find(v=>v.id===part.id+plan.padId&&v.number==='2'&&v.net==='VBAT_CELL');
    const copper=crystal?crystalBoardCopper(plan,part):checkHolderCopper(plan,part,pin);
    const camAfter=await exportLandCam(a,t,path.join(dir,'copper-after.zip'));
    return {status:'ok',pcbPadShape:pin?.padShape,pcbPadHole:pin?.hole,copper,camAfter,design};
  });
  need(check.status==='ok'&&check.resourceCleanup?.status==='ok',check.code??'HOLDER_IMPORTED_INSPECTION');
  const proof={...prepared.frozen,path:prepared.file,fileSha256:prepared.hash,pcbPadShape:check.pcbPadShape,pcbPadHole:check.pcbPadHole,copper:check.copper,camAfter:check.camAfter,proofPath};
  return withCam(proof);
}
