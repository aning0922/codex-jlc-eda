import {fingerprint} from './drawing.mjs';
// Keep the first accepted observation immutable. Failure does not erase the
// copper checkpoint, grant replay eligibility, or become a successful rollback.
export function invalidateRouteObservation(action,result){
 if(action.state==='completed'||action.afterNative||action.invalidation){
  action.invalidation??={at:new Date().toISOString(),previousState:action.state,
   acceptedResultFingerprint:action.result?fingerprint(action.result):null,
   acceptedNativeFingerprint:action.afterNative?fingerprint(action.afterNative):null};
  action.state='invalidated';
  action.failureReadbacks??=[];action.failureReadbacks.push(result);
 }
 action.lastReadback=result;
 return result;
}
export function guiParameterCoverage(action){
 if(action.phase!=='prepare_ui')return {transport:'official_api',cornerStyle:'passed_to_api',optimization:'passed_to_api',outputParameterVerification:false};
 return {transport:'native_gui',netsLayersKeep:'actual_copper_scope_readback',
  cornerStyle:'unverified_gui_mapping',optimization:'unverified_gui_mapping',
  allRequestedParametersVerified:false,
  qualification:'Toolbar angle and JRouter engine selection do not prove API cornerStyle/optimization mapping. Copper scope matching is separate.'};
}
