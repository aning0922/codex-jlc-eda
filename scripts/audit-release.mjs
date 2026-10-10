import {readFile,lstat} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allow=JSON.parse(await readFile(path.join(root,'release-files.json')));
const patterns=[['personal-home',new RegExp('/'+'Users/[^/\\s]+/|/'+'home/[^/\\s]+/')],['private-project',new RegExp('咖啡'+'机项目|EDA 插件 '+'验证')],['credential',new RegExp('-----BEGIN '+'.*PRIVATE'+' KEY-----|gh[pousr]_'+'[A-Za-z0-9]{30,}|sk-'+'[A-Za-z0-9]{32,}|AKIA'+'[A-Z0-9]{16}')],['private-link',new RegExp('codex'+':\\/\\/|chatgpt'+'.com/c/')]];
const findings=[];
for(const name of new Set([...allow.source,...allow.runtime])){
 const file=path.resolve(root,name);if(!file.startsWith(root+path.sep))throw Error('Outside package root');
 const s=await lstat(file);if(!s.isFile()||s.isSymbolicLink())throw Error('Unsafe file: '+name);
 const b=await readFile(file);if(b.includes(0))findings.push({path:name,kind:'binary'});
 const lines=b.toString('utf8').split('\n');for(const [i,line]of lines.entries())for(const [kind,re]of patterns)if(re.test(line))findings.push({path:name,line:i+1,kind});
}
console.log(JSON.stringify({status:findings.length?'failed':'passed',sourceFiles:allow.source.length,runtimeFiles:allow.runtime.length,findings,scope:'bounded credential/path/private-name patterns plus regular-file and binary checks; not a proof of absence of every possible secret'},null,2));
if(findings.length)process.exitCode=1;
