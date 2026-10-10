import {extractNativeCopper} from './native-copper-evidence.mjs';
import {fingerprint} from './drawing.mjs';import {compareRoutingCheckpoint} from './p3.mjs';import {proveStoredPadContainedLines} from './file-model-evidence.mjs';
const fail=code=>({status:'mismatch',code,stagePreservationOnly:true});
export function reconcileStageApiProjection({expected,actual,storedBefore,storedAfter,archiveData,document}){
 const strict=compareRoutingCheckpoint(expected,actual,{compareRules:false});if(strict.status==='matched')return {status:'matched',strict,native:actual,reconstructed:[],stagePreservationOnly:true};
 if(!storedBefore?.complete||!storedAfter?.complete||storedBefore.documentUuid!==storedAfter.documentUuid||fingerprint(storedBefore.rows)!==storedBefore.sha256||fingerprint(storedAfter.rows)!==storedAfter.sha256||storedBefore.sha256!==storedAfter.sha256)return fail('FILE_STAGE_RAW_COPPER_CHANGED');
 let archiveCopper;try{archiveCopper=extractNativeCopper(archiveData,storedAfter.documentUuid,{native:actual,document});}catch{return fail('FILE_STAGE_ARCHIVE_COPPER_UNPROVEN');}
 if(archiveCopper.sha256!==storedAfter.sha256)return fail('FILE_STAGE_ARCHIVE_COPPER_CHANGED');
 const actualIds=new Set(actual.objects.map(x=>x.primitiveId));if(actualIds.size!==actual.objects.length||actual.objects.some(x=>!expected.objects.some(y=>y.primitiveId===x.primitiveId)))return fail('FILE_STAGE_API_EXTRA_OR_DUPLICATE');
 const present=compareRoutingCheckpoint({...expected,objects:expected.objects.filter(x=>actualIds.has(x.primitiveId))},actual,{compareRules:false});if(present.status!=='matched')return fail('FILE_STAGE_PRESENT_API_COPPER_CHANGED');
 const missing=expected.objects.filter(x=>!actualIds.has(x.primitiveId)),reconstructed=[];
 for(const x of missing){
  if(x.kind!=='Line'||Math.hypot(x.endX-x.startX,x.endY-x.startY)>.1||!Number.isFinite(x.lineWidth)||x.lineWidth<=0)return fail('FILE_STAGE_API_MISSING_UNSUPPORTED');
  const rows=storedAfter.rows.filter(r=>r.id===x.primitiveId&&r.type==='LINE');if(rows.length!==1)return fail('FILE_STAGE_MISSING_LINE_RAW_RECORD_UNPROVEN');const b=rows[0].body,y={kind:'Line',primitiveId:rows[0].id,net:b.netName,layer:b.layerId,startX:b.startX,startY:b.startY,endX:b.endX,endY:b.endY,lineWidth:b.width,primitiveLock:b.locked};
  if(compareRoutingCheckpoint({...expected,objects:[x]},{...actual,objects:[y]},{compareRules:false}).status!=='matched')return fail('FILE_STAGE_MISSING_LINE_RAW_VALUE_CHANGED');reconstructed.push(y);
 }
 let containment;try{containment=proveStoredPadContainedLines(archiveData,document,reconstructed);}catch(error){return fail(error.code??error.message);}
 const native={...actual,objects:[...actual.objects,...reconstructed]},comparison=compareRoutingCheckpoint(expected,native,{compareRules:false});
 return {status:comparison.status,strict,comparison,native,reconstructed,containment,storedCopperSha256:storedAfter.sha256,observedApiCount:actual.objects.length,sourceStageCount:expected.objects.length,stagePreservationOnly:true,routeQualificationGranted:false,qualification:'Only source-identical stored lines <=0.1mil, fully pad-contained, may supplement failed-stage preservation readback. Strict API diagnostics remain mismatch; no geometry tolerance widened or ordinary/file-route success gate changed.'};
}
