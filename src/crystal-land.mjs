import {isDeepStrictEqual as equal} from 'node:util';
import {unzipSync,strFromU8} from 'fflate';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {parseCam} from './manufacturing-files.mjs';
import {camGeometry} from './manufacturing-geometry.mjs';

const mm=.0254,near=(a,b,t)=>Number.isFinite(a)&&Math.abs(a-b)<=t;
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'unknown'});};
const nets={'1':'LSE_IN','2':'','3':'','4':'LSE_OUT'};
export function crystalLandPlan(archive,parts,ref){
  const c=parts.find(c=>c.uniqueId===ref&&c.designator===ref);
  check(c?.supplierId==='C108687'&&c.manufacturerPart==='SSP-T7-F 32.768kHz 20PPM12.5pF'&&c.layer===1&&c.rotation===0&&
    parts.filter(p=>p.footprint.uuid===c.footprint.uuid).length===1,'CRYSTAL_UNIQUE_TOP_INSTANCE');
  const model=nativeModelRecords(archive).get(c.footprint.uuid),meta=model?.rows.filter(r=>r.type==='META');
  check(model?.docType==='FOOTPRINT'&&meta.length===1&&meta[0].body.source==='f9d238b18e8a4114a6eaf8987aa86d60|0819f05c4eef4c71ace90d822a990e87','CRYSTAL_LAND_MODEL_BINDING');
  const rows=model.rows.filter(r=>r.type==='PAD').sort((a,b)=>a.body.num.localeCompare(b.body.num));
  check(equal(rows.map(r=>r.body.num),['1','2','3','4'])&&c.pins.length===4,'CRYSTAL_PAD_COUNT');
  const [a,b,d,e]=rows.map(r=>r.body);
  check(a.centerX===e.centerX&&b.centerX===d.centerX&&a.centerX<b.centerX&&
    a.centerY===b.centerY&&d.centerY===e.centerY&&a.centerY<e.centerY&&near((b.centerX-a.centerX)*mm,6.3,.001),'CRYSTAL_PAD_ORIENTATION');
  const midpoint=(a.centerY+e.centerY)/2,sourceGap=(e.centerY-a.centerY-a.defaultPad.width)*mm;
  check(near(sourceGap,.25,.001),'CRYSTAL_SOURCE_GAP_UNEXPECTED');
  const pads=rows.map(({id,body:p})=>{
    const pin=c.pins.find(v=>v.number===p.num&&v.id===c.id+id),lower=['1','2'].includes(p.num);
    check(pin&&pin.net===nets[p.num]&&pin.layer===1&&pin.hole===null&&pin.padShape[0]==='RECT'&&
      p.layerId===1&&p.hole===null&&!p.specialPad?.length&&p.defaultPad.padType==='RECT'&&p.defaultPad.radius===0&&
      near(p.defaultPad.width*mm,.6,.001)&&near(p.defaultPad.height*mm,1.2,.001)&&equal(p.defaultPad,a.defaultPad)&&
      p.padAngle===(['1','3'].includes(p.num)?270:90)&&near(p.padOffsetX,0,.005)&&near(p.padOffsetY,0,.005),'CRYSTAL_PAD_SOURCE_GEOMETRY');
    const centerY=Number((midpoint+(lower?-1:1)*(p.defaultPad.width+.300/mm)/2).toFixed(6));
    return {padId:id,before:p,after:{...p,centerY},number:p.num};
  });
  return {ref,modelUuid:model.uuid,source:meta[0].body.source,componentId:c.id,x:c.x,y:c.y,sourceGapMm:sourceGap,targetGapMm:.300,pads};
}

export function crystalBoardCopper(plan,part){
  check(part?.id===plan.componentId&&part.footprint.uuid===plan.modelUuid&&near(part.x,plan.x,1e-6)&&near(part.y,plan.y,1e-6)&&part.rotation===0,'CRYSTAL_BOARD_BINDING');
  return plan.pads.map(({padId,number,before,after})=>{
    const p=part.pins.find(p=>p.id===part.id+padId&&p.number===number);
    check(p&&p.net===nets[number]&&p.layer===1&&p.hole===null&&p.padShape[0]==='RECT'&&
      near(p.x,part.x+after.centerX,.051)&&near(p.y,part.y+after.centerY,.051),'CRYSTAL_BOARD_PAD_POSITION');
    return {number,padId,nativeY:p.y,beforeX:(part.x+before.centerX)*mm,beforeY:(part.y+before.centerY)*mm,
      x:(part.x+after.centerX)*mm,y:(part.y+after.centerY)*mm,w:after.defaultPad.height*mm,h:after.defaultPad.width*mm};
  });
}

// A rectangular Gerber aperture may be stored with its own orientation. Compare its actual copper extents.
export function crystalCamPads(bytes,pads,before=false){
  const files=unzipSync(bytes),top=Object.keys(files).filter(k=>/\.gtl$/i.test(k));check(top.length===1,'CRYSTAL_TOP_CAM_MISSING');
  const parsed=parseCam(strFromU8(files[top[0]]));check(parsed.done&&parsed.units==='mm','CRYSTAL_TOP_CAM_FORMAT');
  const flashes=camGeometry(parsed).shapes.filter(s=>s.anchor),selected=pads.map(p=>{
    const x=before?p.beforeX:p.x,y=before?p.beforeY:p.y;
    const hits=flashes.filter(s=>s.kind==='rect'&&near(s.x,x,.00003)&&near(s.y,y,.00003)&&near(s.w,p.w,.00003)&&near(s.h,p.h,.00003));
    check(hits.length===1,'CRYSTAL_PHYSICAL_LAND_UNCONFIRMED');return hits[0];
  });
  check(new Set(selected).size===4,'CRYSTAL_CAM_PAD_IDENTITY');
  const gaps=[[0,3],[1,2]].map(([low,high])=>selected[high].y-selected[low].y-(selected[high].h+selected[low].h)/2);
  check(gaps.every(g=>near(g,before ? .25 : .300,before ? .001 : .00003)),'CRYSTAL_CAM_EDGE_GAP');
  const other=flashes.filter(s=>!selected.includes(s)).map(s=>JSON.stringify([s.anchor,s.tool.shape,s.tool.params,s.tool.hole??null])).sort();
  const drill=Object.fromEntries(Object.keys(files).filter(k=>/\.drl$/i.test(k)).sort().map(k=>[k,strFromU8(files[k]).split(/\r?\n/).filter(l=>!l.startsWith(';')).join('\n')]));
  return {gaps,lands:selected.map((s,i)=>({number:pads[i].number,x:s.x,y:s.y,w:s.w,h:s.h})),other,drill};
}
export function verifyCrystalCam(before,after,pads){
  const a=crystalCamPads(before,pads,true),b=crystalCamPads(after,pads);
  check(equal(a.other,b.other)&&Object.keys(a.drill).length&&equal(a.drill,b.drill),'CRYSTAL_NON_TARGET_CAM_CHANGED');
  return {sourceGapsMm:a.gaps,gapsMm:b.gaps,lands:b.lands,otherFlashesPreserved:a.other.length,unchangedDrillProgram:true};
}
