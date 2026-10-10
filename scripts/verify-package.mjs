import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,chmod,rm,access,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
const sourceRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const root=path.resolve(process.argv[2]??'.'),runtime=process.argv.includes('--runtime');
const market=JSON.parse(await readFile(path.join(root,'.agents/plugins/marketplace.json')));
assert.equal(market.name,'jlc-eda-alpha');assert.equal(market.plugins.length,1);
const entry=market.plugins[0];assert.equal(entry.name,'jlc-eda');assert.ok(entry.source.path.startsWith('./'));
const plugin=path.resolve(root,entry.source.path);assert.ok(plugin===root||plugin.startsWith(root+path.sep));
const manifest=JSON.parse(await readFile(path.join(plugin,'.codex-plugin/plugin.json')));
const pkg=JSON.parse(await readFile(path.join(sourceRoot,'package.json')));assert.equal(manifest.version,pkg.version);
const mcp=JSON.parse(await readFile(path.join(plugin,'.mcp.json'))).mcpServers.jlc_eda;
assert.equal(mcp.command,'/bin/sh');assert.deepEqual(mcp.args,['./scripts/launch-mcp.sh']);
await access(path.join(plugin,'skills/jlc-eda-project/SKILL.md'));
let packageFilesVerified=0;
if(runtime){
 await assert.rejects(access(path.join(plugin,'node_modules')));
 const inventory=JSON.parse(await readFile(path.join(root,'MANIFEST.json')));
 assert.equal(inventory.version,pkg.version);assert.equal(inventory.kind,'runtime');
 for(const row of inventory.files){
  const file=path.resolve(root,row.path);assert.ok(file.startsWith(root+path.sep));
  const stat=await lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  const bytes=await readFile(file);assert.equal(bytes.length,row.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),row.sha256,row.path);packageFilesVerified++;
 }
 for(const name of ['README.md','README.en.md','docs/assets/workflow.svg','LICENSE','SECURITY.md'])await access(path.join(plugin,name));
}
const temp=await mkdtemp(path.join(os.tmpdir(),'jlc-protocol-'));
let client,transport;
try{
 const fake=path.join(temp,'fake-cli.mjs'),log=path.join(temp,'calls.jsonl');
 await writeFile(fake,'#!'+process.execPath+'\n'+`import {appendFileSync} from 'node:fs';const args=process.argv.slice(2);appendFileSync(${JSON.stringify(log)},JSON.stringify(args)+'\\n');if(args[0]!=='doctor')process.exit(91);console.log(JSON.stringify({ok:true,value:{connected:false,versionMatch:null}}));\n`);await chmod(fake,0o755);
 const env={PATH:process.env.PATH,TMPDIR:temp,JLCEDA_CLI_PATH:fake,CODEX_MCP_NODE_PATH:process.execPath};
 transport=new StdioClientTransport({command:mcp.command,args:[path.join(plugin,mcp.args[0])],cwd:temp,env,stderr:'pipe'});
 let stderr='';transport.stderr?.on('data',b=>stderr+=b);
 client=new Client({name:'release-offline-qualification',version:'1.0.0'});await client.connect(transport);
 assert.equal(client.getServerVersion().version,pkg.version);
 const {tools}=await client.listTools();assert.equal(tools.length,35);assert.equal(new Set(tools.map(t=>t.name)).size,35);
 const expected=JSON.parse(await readFile(path.join(sourceRoot,'tests/fixtures/public-tools.json')));assert.deepEqual(tools,expected);
 let rejected=0;for(const tool of tools){const r=(await client.callTool({name:tool.name,arguments:{__unknown_input:true}})).structuredContent;assert.equal(r.pluginVersion,pkg.version);assert.equal(r.code,'INVALID_INPUT',tool.name);rejected++;}
 await assert.rejects(access(log));
 const doctor=(await client.callTool({name:'jlc_eda_doctor',arguments:{}})).structuredContent;
 assert.equal(doctor.pluginVersion,pkg.version);assert.equal(doctor.publicToolCount,35);assert.equal(doctor.editorConnected,false);assert.equal(doctor.status,'needs_ui');
 await client.close();client=null;await transport.close();transport=null;
 const calls=(await readFile(log,'utf8')).trim().split('\n').map(JSON.parse);assert.deepEqual(calls,[['doctor']]);assert.equal(stderr,'');
 console.log(JSON.stringify({status:'passed',version:pkg.version,tools:35,schemasMatchFrozenBaseline:true,invalidInputsRejected:rejected,marketplaceResolved:true,packageFilesVerified,runtimeWithoutNodeModules:runtime,relocatedLaunch:true,doctor:'simulated CLI, disconnected',cliCalls:calls,realEdaCalls:0,hostMcpInvocation:false},null,2));
}finally{await client?.close();await transport?.close();await rm(temp,{recursive:true,force:true});}
