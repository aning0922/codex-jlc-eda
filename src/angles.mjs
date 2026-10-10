// Native save/reopen can express 270 degrees as -90.00000000000001.
// This tolerance is angular only; it does not change coordinate tolerances.
export const ANGLE_EPSILON_DEGREES=1e-8;
export function equivalentAngle(a,b){
 if(!Number.isFinite(a)||!Number.isFinite(b))return false;
 const normalize=x=>((x%360)+360)%360;
 const d=Math.abs(normalize(a)-normalize(b));
 return Math.min(d,360-d)<=ANGLE_EPSILON_DEGREES;
}
