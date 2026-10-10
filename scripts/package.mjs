import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';import {zipSync,strToU8} from 'fflate';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pkg=JSON.parse(await readFile(path.join(root,'package.json'))),allow=JSON.parse(await readFile(path.join(root,'release-files.json')));
const out=path.join(root,'release',pkg.version);
const sha=b=>createHash('sha256').update(b).digest('hex');
const options={mtime:new Date('1980-01-01T00:00:00Z'),level:9};
async function files(names,prefix=''){
 const result={},manifest=[];
 for(const name of [...names].sort()){
  if(name.startsWith('/')||name.split('/').some(x=>x==='..'||x==='node_modules')||name.includes('\\'))throw Error('Unsafe package path: '+name);
  const p=path.join(root,name),s=await lstat(p);if(!s.isFile()||s.isSymbolicLink())throw Error('Not a regular file: '+name);
  const b=new Uint8Array(await readFile(p)),target=prefix+name;
  result[target]=[b,{...options,os:3,attrs:((s.mode&0o777)|0o100000)<<16}];manifest.push({path:target,bytes:b.length,sha256:sha(b)});
 }return {result,manifest};
}
await mkdir(out,{recursive:true});
const source=await files(allow.source),runtime=await files(allow.runtime,'plugins/jlc-eda/');
const market=JSON.parse(await readFile(path.join(root,'.agents/plugins/marketplace.json')));market.plugins[0].source.path='./plugins/jlc-eda';
const mb=strToU8(JSON.stringify(market,null,2)+'\n');runtime.result['.agents/plugins/marketplace.json']=[mb,options];runtime.manifest.push({path:'.agents/plugins/marketplace.json',bytes:mb.length,sha256:sha(mb)});
const outputs=[];
for(const [kind,entry]of [['source',source],['runtime',runtime]]){
 entry.manifest.sort((a,b)=>a.path.localeCompare(b.path,'en'));
 const manifest=JSON.stringify({version:pkg.version,kind,files:entry.manifest},null,2)+'\n';
 entry.result['MANIFEST.json']=[strToU8(manifest),options];
 const name=`codex-jlc-eda-${pkg.version}-${kind}.zip`,bytes=zipSync(entry.result,options);
 await writeFile(path.join(out,name),bytes);await writeFile(path.join(out,`${kind}-manifest.json`),manifest);
 outputs.push({name,bytes:bytes.length,sha256:sha(bytes),payloadFiles:entry.manifest.length,manifest:'MANIFEST.json (self excluded)'});
}
await writeFile(path.join(out,'SHA256SUMS'),outputs.map(x=>`${x.sha256}  ${x.name}`).join('\n')+'\n');
await writeFile(path.join(out,'packages.json'),JSON.stringify({version:pkg.version,outputs},null,2)+'\n');
console.log(JSON.stringify({version:pkg.version,outputs},null,2));
