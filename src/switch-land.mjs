import {isDeepStrictEqual as equal} from 'node:util';
import {nativeModelRecords} from './file-model-evidence.mjs';
import {rectangularPadCam} from './crystal-land.mjs';

const mm=.0254,mil=value=>Number((value/mm).toFixed(6)),near=(a,b,t=.00003)=>Number.isFinite(a)&&Math.abs(a-b)<=t;
const check=(ok,code)=>{if(!ok)throw Object.assign(Error(code),{code,status:'unknown'});};
export function switchLandPlan(data,components,config){
 const refs=[config.resetSwitch,config.bootSwitch],parts=refs.map(ref=>components.find(c=>c.uniqueId===ref&&c.designator===ref));
 check(new Set(refs).size===2&&parts.every(c=>c?.supplierId==='C36498961'&&c.manufacturerPart==='HX 3x4x2-2P-2.5N'&&c.layer===1&&c.rotation===0&&c.pins.length===2),'SWITCH_PAIR_BINDING');
 const modelUuid=parts[0].footprint.uuid;check(parts[1].footprint.uuid===modelUuid&&components.filter(c=>c.footprint.uuid===modelUuid).length===2,'SWITCH_MODEL_OTHER_USERS');
 const model=nativeModelRecords(data).get(modelUuid),meta=model?.rows.filter(r=>r.type==='META'),rows=model?.rows.filter(r=>r.type==='PAD').sort((a,b)=>a.body.num.localeCompare(b.body.num));
 check(model?.docType==='FOOTPRINT'&&meta?.length===1&&meta[0].body.source==='dc3f8cc7ecf7413e8a301cb9514090a5|0819f05c4eef4c71ace90d822a990e87'&&equal(rows.map(r=>r.body.num),['1','2']),'SWITCH_FOOTPRINT_SOURCE');
 const [left,right]=rows.map(r=>r.body),middle=(left.centerX+right.centerX)/2;
 check(left.centerY===right.centerY&&near((right.centerX-left.centerX)*mm,4.0701,.001),'SWITCH_SOURCE_PITCH');
 const pads=rows.map(({id,body:p},i)=>{
   check(p.layerId===1&&p.hole===null&&!p.specialPad?.length&&p.defaultPad.padType==='RECT'&&p.defaultPad.radius===0&&p.padAngle===0&&
     near(p.padOffsetX,0,.005)&&near(p.padOffsetY,0,.005)&&near(p.defaultPad.width*mm,1.53,.0001)&&near(p.defaultPad.height*mm,1.36,.0001),'SWITCH_SOURCE_RECTANGLE');
   const centerX=Number((middle+(i?1:-1)*4.45/mm/2).toFixed(6));
   return {number:p.num,padId:id,before:p,after:{...p,centerX,defaultPad:{...p.defaultPad,width:mil(1.05),height:mil(2)}}};
 });
 const instances=parts.map((c,i)=>{
   const nets=i?['BOOT0','+3V3']:['NRST','GND'];
   for(const [k,p] of pads.entries()){
     const pin=c.pins.find(q=>q.id===c.id+p.padId&&q.number===p.number);
     check(pin?.net===nets[k]&&pin.layer===1&&pin.hole===null&&pin.padShape[0]==='RECT'&&near(pin.x,c.x+p.before.centerX,.051)&&near(pin.y,c.y+p.before.centerY,.051),'SWITCH_EXISTING_PAD_BINDING');
   }
   return {ref:c.uniqueId,id:c.id,x:c.x,y:c.y,nets};
 });
 return {modelUuid,refs,source:meta[0].body.source,pads,instances};
}
export function switchBoardCopper(plan,components){
 return plan.instances.flatMap(c=>{
   const actual=components.find(p=>p.id===c.id&&p.uniqueId===c.ref&&p.footprint.uuid===plan.modelUuid);
   check(actual?.layer===1&&actual.rotation===0&&near(actual.x,c.x,1e-6)&&near(actual.y,c.y,1e-6),'SWITCH_BOARD_POSE');
   return plan.pads.map(({number,padId,before,after},i)=>{
     const pin=actual.pins.find(p=>p.id===c.id+padId&&p.number===number);
     check(pin?.net===c.nets[i]&&pin.hole===null&&pin.layer===1&&near(pin.x,c.x+after.centerX,.051)&&near(pin.y,c.y+after.centerY,.051)&&
       pin.padShape[0]==='RECT'&&near(pin.padShape[1],after.defaultPad.width,.051)&&near(pin.padShape[2],after.defaultPad.height,.051)&&pin.padShape[3]===0,'SWITCH_BOARD_LAND_UNCONFIRMED');
     return {ref:c.ref,componentId:c.id,number,padId,nativeX:pin.x,nativeShape:pin.padShape,beforeX:(c.x+before.centerX)*mm,beforeY:(c.y+before.centerY)*mm,
       beforeW:before.defaultPad.width*mm,beforeH:before.defaultPad.height*mm,x:(c.x+after.centerX)*mm,y:(c.y+after.centerY)*mm,w:after.defaultPad.width*mm,h:after.defaultPad.height*mm};
   });
 });
}
export function switchCamPads(bytes,pads,before=false){
 const cam=rectangularPadCam(bytes,pads,before),pairs=[];
 for(const i of [0,2]){
   const a=cam.lands[i],b=cam.lands[i+1];check(pads[i].ref===pads[i+1].ref&&a.number==='1'&&b.number==='2'&&near(b.y,a.y),'SWITCH_CAM_PAIR');
   const pitch=b.x-a.x,inner=pitch-(a.w+b.w)/2,outer=pitch+(a.w+b.w)/2;
   if(!before)check(near(pitch,4.45)&&near(inner,3.4)&&near(outer,5.5)&&[a,b].every(p=>near(p.w,1.05)&&near(p.h,2)),'SWITCH_CAM_DRAWING_DIMENSIONS');
   pairs.push({ref:pads[i].ref,widthMm:a.w,heightMm:a.h,pitchMm:pitch,innerGapMm:inner,outerWidthMm:outer});
 }
 return {...cam,pairs};
}
export function verifySwitchCam(before,after,pads){
 const a=switchCamPads(before,pads,true),b=switchCamPads(after,pads);
 check(equal(a.other,b.other)&&Object.keys(a.drill).length&&equal(a.drill,b.drill),'SWITCH_NON_TARGET_CAM_CHANGED');
 return {sourcePairs:a.pairs,pairs:b.pairs,otherFlashesPreserved:a.other.length,unchangedDrillProgram:true};
}
