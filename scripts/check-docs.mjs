import {readFile,access} from 'node:fs/promises';
import path from 'node:path';import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const allow=JSON.parse(await readFile(path.join(root,'release-files.json'))),pkg=JSON.parse(await readFile(path.join(root,'package.json')));
const issues=[];
const slug=s=>s.toLowerCase().replace(/<[^>]+>/g,'').replace(/[^\p{L}\p{N}\s_-]/gu,'').replace(/\s/g,'-');
for(const name of allow.source.filter(p=>p.endsWith('.md'))){
 const text=await readFile(path.join(root,name),'utf8');
 if((text.match(/^```/gm)??[]).length%2)issues.push({path:name,kind:'unclosed-code-fence'});
 for(const m of text.matchAll(/!?\[[^\]]*\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g)){
  const target=m[1];if(/^[a-z]+:/i.test(target))continue;
  const [rel,anchor]=target.split('#'),full=path.resolve(path.dirname(path.join(root,name)),rel||path.basename(name));
  if(!full.startsWith(root+path.sep)){issues.push({path:name,kind:'outside-root-link'});continue;}
  try{await access(full);}catch{issues.push({path:name,kind:'missing-link',target});continue;}
  if(anchor&&full.endsWith('.md')){
   const dest=await readFile(full,'utf8'),anchors=[...dest.matchAll(/^#{1,6}\s+(.+)$/gm)].map(x=>slug(x[1]));
   if(!anchors.includes(decodeURIComponent(anchor)))issues.push({path:name,kind:'missing-anchor',target});
  }
 }
}
const zh=await readFile(path.join(root,'README.md'),'utf8'),en=await readFile(path.join(root,'README.en.md'),'utf8');
for(const [name,text,other]of [['README.md',zh,'README.en.md'],['README.en.md',en,'README.md']]){
 if(!text.includes(pkg.version)||!text.includes('35')||!text.includes('4.1.60')||!text.includes('fflate'))issues.push({path:name,kind:'missing-shared-facts'});
 if(!text.includes(']('+other+')'))issues.push({path:name,kind:'language-switch-missing'});
 if(/shields\.io|badge\.svg|actions\/workflows\/.*badge/.test(text))issues.push({path:name,kind:'unverified-badge'});
}
const blocks=s=>[...s.matchAll(/```sh\n([\s\S]*?)```/g)].map(m=>m[1]);
if(JSON.stringify(blocks(zh))!==JSON.stringify(blocks(en)))issues.push({kind:'bilingual-shell-commands-differ'});
const svg=await readFile(path.join(root,'docs/assets/workflow.svg'),'utf8');if(/<script|<foreignObject|href="https?:/i.test(svg)||!svg.includes('<title')||!svg.includes('<desc'))issues.push({kind:'svg-accessibility-or-external-content'});
console.log(JSON.stringify({status:issues.length?'failed':'passed',version:pkg.version,markdownFiles:allow.source.filter(x=>x.endsWith('.md')).length,bilingualCommandBlocks:blocks(zh).length,issues},null,2));
if(issues.length)process.exitCode=1;
