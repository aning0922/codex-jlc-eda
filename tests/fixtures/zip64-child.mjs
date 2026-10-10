import {zip64Fixture} from './zip64.mjs';
const {unzipSync}=await import(process.argv[3] || 'fflate');
const extra=process.argv[2]==='valid';
try {
 const files=unzipSync(zip64Fixture({extra}));
 console.log(JSON.stringify({state:'completed',files:Object.fromEntries(Object.entries(files).map(([k,b])=>[k,b.length]))}));
}catch(error){
 console.log(JSON.stringify({state:'rejected',code:error.code,message:error.message}));
}
