// The native wire API joins segments only at explicit endpoints.
const snap = n => Math.round(n*1e6)/1e6;
const within = (x,a,b) => x>=Math.min(a,b) && x<=Math.max(a,b);
const onSegment = (x,y,[x1,y1,x2,y2]) =>
  (x1===x2 && x===x1 && within(y,y1,y2)) || (y1===y2 && y===y1 && within(x,x1,x2));
const fail = code => {throw Object.assign(Error(code),{code,status:'failed'});};

export function planJunctions(circuit,document){
 const plans=new Map();
 if(!circuit.nets.some(n=>n.junction))return plans;
 if(document.truncated!==false)fail('JUNCTION_DOCUMENT_TRUNCATED');
 const pins=new Map(),segments=[];
 for(const c of document.components)for(const p of c.pins){
  const id=c.uniqueId+'.'+p.number;
  if(pins.has(id)||![p.x,p.y].every(Number.isFinite))fail('JUNCTION_PIN_UNCONFIRMED');
  pins.set(id,{componentId:c.id,pin:p.number,x:snap(p.x),y:snap(p.y),rotation:p.rotation});
 }
 for(const net of circuit.nets){
  const ownedPins=new Set(net.endpoints.map(e=>e.ref+'.'+e.pin));
  const anchors=[],lines=[];
  for(const e of net.endpoints){
   const p=pins.get(e.ref+'.'+e.pin);
   if(!p)fail('JUNCTION_PIN_UNCONFIRMED');
   const {x,y,rotation}=p,axis={0:[1,0],90:[0,1],180:[-1,0],270:[0,-1]}[rotation];
   if(!axis)fail('JUNCTION_PIN_ROTATION_UNSUPPORTED');
   const end=net.junction?.map(snap)??[x+axis[0]*e.stubLength,y+axis[1]*e.stubLength];
   const elbow=axis[0]?[end[0],y]:[x,end[1]];
   if((elbow[0]-x)*axis[0]+(elbow[1]-y)*axis[1]<=0)fail('JUNCTION_BEHIND_PIN');
   lines.push([x,y,...elbow]);
   if(elbow[0]!==end[0]||elbow[1]!==end[1])lines.push([...elbow,...end]);
   anchors.push(p);
  }
  for(const line of lines){
   for(const [id,p] of pins){
    if(!onSegment(p.x,p.y,line))continue;
    const endpoint=p.x===line[0]&&p.y===line[1]||p.x===line[2]&&p.y===line[3];
    if(!ownedPins.has(id)||!endpoint)fail('JUNCTION_TOUCHES_OTHER_PIN');
   }
   for(const prev of segments)if(prev.name!==net.name){
    const [a,b,c,d]=line,[x,y,u,v]=prev.line;
    if(onSegment(a,b,prev.line)||onSegment(c,d,prev.line)||onSegment(x,y,line)||onSegment(u,v,line)||
      (a===c&&y===v&&within(a,x,u)&&within(y,b,d))||(b===d&&x===u&&within(x,a,c)&&within(b,y,v)))fail('JUNCTION_NET_CROSSING');
   }
   segments.push({name:net.name,line});
  }
  if(net.junction){
   const horizontal=lines.filter(([x,y,u,v])=>y===v&&x!==u)
     .sort((a,b)=>Math.abs(b[2]-b[0])-Math.abs(a[2]-a[0]))[0];
   const labelAt=horizontal?[(horizontal[0]+horizontal[2])/2,horizontal[1]-12]:null;
   plans.set(net.name,{anchors,lines,labelAt});
  }
 }
 return plans;
}
