// Deliberately bounded to the observed official two-layer, flattened DSN/SES format.
import {createHash} from 'node:crypto';
export const fileSha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function parseSexpr(text){
 if(typeof text!=='string'||Buffer.byteLength(text)>2*1024*1024)throw Error('SPECCTRA_SIZE');
 const tokens=[];let i=0;
 while(i<text.length){const c=text[i];if(/\s/.test(c)){i++;continue;}if(c==='('||c===')'){tokens.push(c);i++;}
 else if(c==='"'){let s='',closed=false;i++;while(i<text.length){const v=text[i++];if(v==='"'){closed=true;break;}if(v==='\\'){const e=text[i++];if(!['"','\\'].includes(e))throw Error('SPECCTRA_ESCAPE');s+=e;}else s+=v;}if(!closed)throw Error('SPECCTRA_QUOTE');tokens.push({atom:s});}
 else{const start=i;while(i<text.length&&!/[\s()]/.test(text[i]))i++;tokens.push({atom:text.slice(start,i)});}
 if(tokens.length>100000)throw Error('SPECCTRA_TOKENS');}
 let pos=0;const read=depth=>{if(depth>32)throw Error('SPECCTRA_DEPTH');const t=tokens[pos++];if(t==='('){const a=[];while(tokens[pos]!==')'){if(pos>=tokens.length)throw Error('SPECCTRA_CLOSE');a.push(read(depth+1));}pos++;return a;}if(!t||t===')')throw Error('SPECCTRA_TOKEN');return t.atom;};
 const root=read(0);if(pos!==tokens.length||!Array.isArray(root))throw Error('SPECCTRA_ROOT');return root;
}
export const children=(n,k)=>n.filter(x=>Array.isArray(x)&&String(x[0]).toLowerCase()===k.toLowerCase());
export function child(n,k){const xs=children(n,k);if(xs.length!==1)throw Error('SPECCTRA_AMBIGUOUS_'+k);return xs[0];}
export const number=x=>{if(typeof x!=='string'||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?$/i.test(x)||!Number.isFinite(Number(x)))throw Error('SPECCTRA_NUMBER');return Number(x);};
export function serializeSexpr(n){if(Array.isArray(n))return '('+n.map(serializeSexpr).join(' ')+')';if(typeof n!=='string')throw Error('SPECCTRA_ATOM');return !n||/[\s()"\\]/.test(n)?JSON.stringify(n):n;}
export function omitNodesPreservingBytes(text,root,nodes){
 const ast=[];const walk=n=>{if(Array.isArray(n)){ast.push(n);n.forEach(walk);}};walk(root);const positions=[],stack=[];let quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='\\')i++;else if(c==='"')quoted=false;continue;}if(c==='"'){quoted=true;continue;}if(c==='('){const index=positions.length;positions.push({start:i});stack.push(index);}else if(c===')'){const index=stack.pop();if(index===undefined)throw Error('SPECCTRA_RANGE');positions[index].end=i+1;}}
 if(stack.length||quoted||positions.length!==ast.length)throw Error('SPECCTRA_RANGE');const ranges=[...nodes].map(node=>{const i=ast.indexOf(node);if(i<0)throw Error('SPECCTRA_NODE_RANGE');return {...positions[i],sourceByteStart:Buffer.byteLength(text.slice(0,positions[i].start)),sourceByteEnd:Buffer.byteLength(text.slice(0,positions[i].end))};}).sort((a,b)=>a.start-b.start);
 if(ranges.some((r,i)=>i>0&&r.start<ranges[i-1].end))throw Error('SPECCTRA_OVERLAPPING_OMISSION');let next='',last=0;for(const r of ranges){next+=text.slice(last,r.start);last=r.end;}next+=text.slice(last);return {bytes:Buffer.from(next),ranges,allOtherSourceBytesPreserved:true};
}
const units=n=>{const r=child(n,'resolution');if(r[1]!=='mil'||number(r[2])!==1000)throw Error('SPECCTRA_UNITS');};
const protect=n=>{const t=children(n,'type');if(t.length>1||t.some(x=>x[1]!=='protect'))throw Error('SPECCTRA_TYPE');return t.length===1;};
const known=(n,keys,start=1)=>{for(const x of n.slice(start))if(!Array.isArray(x)||!keys.includes(String(x[0]).toLowerCase()))throw Error('SPECCTRA_UNSUPPORTED_SECTION');};
export function readDsn(bytes){
 const root=parseSexpr(bytes.toString());if(String(root[0]).toLowerCase()!=='pcb')throw Error('DSN_ROOT');units(root);
 const structure=child(root,'structure'),layers=children(structure,'layer').map(x=>x[1]);if(JSON.stringify(layers)!==JSON.stringify(['TopLayer','BottomLayer']))throw Error('DSN_LAYERS');
 const path=child(child(structure,'boundary'),'path'),pts=path.slice(3).map(number);if(path[1]!=='signal'||pts.length!==10)throw Error('DSN_BOUNDARY');const xs=pts.filter((_,i)=>i%2===0),ys=pts.filter((_,i)=>i%2),extent={minX:Math.min(...xs),maxX:Math.max(...xs),minY:Math.min(...ys),maxY:Math.max(...ys)};
 if(extent.minX!==0||extent.minY!==0||extent.maxX<=0||extent.maxY<=0)throw Error('DSN_ORIGIN_UNSUPPORTED');
 const pc=children(child(root,'placement'),'component');if(pc.length!==1||pc[0][1]!=='u1'||JSON.stringify(child(pc[0],'place').slice(1))!==JSON.stringify(['u1','0','0','front','0']))throw Error('DSN_PLACEMENT');
 const library=child(root,'library'),images=children(library,'image');if(images.length!==1||images[0][1]!=='u1')throw Error('DSN_IMAGE');
 const stacks=children(library,'padstack');if(new Set(stacks.map(x=>x[1])).size!==stacks.length)throw Error('DSN_STACK_DUPLICATE');
 const pins=children(images[0],'pin').map(x=>{if(x.length!==5)throw Error('DSN_PIN');return {padstack:x[1],id:x[2],x:number(x[3]),y:number(x[4])};});if(new Set(pins.map(x=>x.id)).size!==pins.length)throw Error('DSN_PIN_DUPLICATE');
 const nets=children(child(root,'network'),'net').map(n=>({name:n[1],pins:child(n,'pins').slice(1)})),pinNet=new Map();for(const n of nets)for(const id of n.pins){if(pinNet.has(id))throw Error('DSN_PIN_NET_AMBIGUOUS');pinNet.set(id,n.name);}for(const p of pins){p.net=pinNet.get('u1-'+p.id)??'';if(!stacks.some(x=>x[1]===p.padstack))throw Error('DSN_PIN_STACK');}for(const id of pinNet.keys())if(!pins.some(p=>'u1-'+p.id===id))throw Error('DSN_NET_PIN_MISSING');
 const wiring=child(root,'wiring'),vias=children(wiring,'via').map(n=>({node:n,stack:n[1],x:number(n[2]),y:number(n[3]),net:child(n,'net')[1],protect:protect(n)})),wires=children(wiring,'wire').map(n=>{const p=child(n,'path');return {layer:p[1],width:number(p[2]),points:p.slice(3).map(number),net:child(n,'net')[1],protect:protect(n)};});
 return {root,extent,layers,pins,nets,stacks,vias,wires,sha256:fileSha(bytes)};
}
export function readSes(bytes,dsn,{allowMissingEmptyNets=false}={}){
 const root=parseSexpr(bytes.toString());if(root[0]!=='session'||root[1]!==child(root,'base_design')[1])throw Error('SES_BASE');
 known(root,['base_design','placement','was_is','routes'],2);const p=child(root,'placement');known(p,['resolution','component']);units(p);const pcs=children(p,'component');if(pcs.length!==1||pcs[0][1]!=='u1'||JSON.stringify(child(pcs[0],'place').slice(1))!==JSON.stringify(['u1','0','0','front','0']))throw Error('SES_PLACEMENT');known(pcs[0],['place'],2);if(child(root,'was_is').length!==1)throw Error('SES_REPLACEMENTS');
 const r=child(root,'routes');known(r,['resolution','parser','library_out','network_out']);units(r);const lib=child(r,'library_out'),network=child(r,'network_out');known(lib,['padstack']);known(network,['net']);const stacks=children(lib,'padstack'),nets=children(network,'net');
 const names=nets.map(x=>x[1]),omittedEmptyNets=dsn.nets.filter(x=>!names.includes(x.name));
 if(new Set(names).size!==names.length||names.some(n=>!dsn.nets.some(x=>x.name===n))||omittedEmptyNets.length&&(!allowMissingEmptyNets||omittedEmptyNets.some(n=>dsn.wires.some(w=>w.net===n.name)||dsn.vias.some(v=>v.net===n.name))))throw Error('SES_NETS');
 if(new Set(stacks.map(s=>s[1])).size!==stacks.length)throw Error('SES_STACK_DUPLICATE');for(const stack of stacks){known(stack,['shape'],2);const original=dsn.stacks.filter(s=>s[1]===stack[1]);if(original.length!==1||circleStack(stack,dsn.layers,1000)!==circleStack(original[0],dsn.layers,1))throw Error('SES_STACK_GEOMETRY_CHANGED');}
 const wires=[],vias=[];const point=(x,y)=>{if(x<dsn.extent.minX||x>dsn.extent.maxX||y<dsn.extent.minY||y>dsn.extent.maxY)throw Error('SES_BOARD_BOUND');};
 for(const n of nets)for(const x of n.slice(2)){if(!Array.isArray(x))throw Error('SES_CHILD');if(x[0]==='wire'){known(x,['path','type']);const p=child(x,'path'),width=number(p[2])/1000,pts=p.slice(3).map(v=>number(v)/1000);if(!dsn.layers.includes(p[1])||width<=0||pts.length<4||pts.length%2)throw Error('SES_WIRE');for(let i=0;i<pts.length;i+=2)point(pts[i],pts[i+1]);wires.push({node:x,net:n[1],layer:p[1],width,points:pts,protect:protect(x)});}else if(x[0]==='via'){known(x,['type'],4);const px=number(x[2])/1000,py=number(x[3])/1000;point(px,py);if(stacks.filter(s=>s[1]===x[1]).length!==1)throw Error('SES_STACK');vias.push({node:x,net:n[1],stack:x[1],x:px,y:py,protect:protect(x)});}else throw Error('SES_UNSUPPORTED');}
 return {root,stacks,wires,vias,omittedEmptyNets:omittedEmptyNets.map(n=>({name:n.name,sourcePins:n.pins.length,sourceCopperObjects:0,resultCopperObjects:0,routed:false})),sha256:fileSha(bytes),baseDesign:child(root,'base_design')[1]};
}
export function circleStack(stack,layers,scale){const circles=children(stack,'shape').map(x=>child(x,'circle'));if(circles.length!==layers.length||circles.some((x,i)=>x[1]!==layers[i]||x.length>5||x.length>3&&(number(x[3])!==0||number(x[4])!==0)))throw Error('VIA_STACK_FORMAT');const diameters=circles.map(x=>number(x[2])/scale);if(diameters.some(x=>x!==diameters[0]||x<=0))throw Error('VIA_STACK_DIAMETER');return diameters[0];}
