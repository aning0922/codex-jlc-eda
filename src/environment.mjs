import os from 'node:os';
import {createHash} from 'node:crypto';
import {getDefaultEnvironment} from '@modelcontextprotocol/sdk/client/stdio.js';
export function protocolEnvironment(env=process.env){
 const result={...getDefaultEnvironment(),TMPDIR:env.TMPDIR??os.tmpdir()};
 for(const key of ['PATH','JLCEDA_CLI_PATH','CODEX_MCP_NODE_PATH'])if(env[key])result[key]=env[key];
 return result;
}
export function environmentIdentity(env=process.env){
 const temp=env.TMPDIR??os.tmpdir();
 return {platform:process.platform,nodeVersion:process.versions.node,nodeExecutable:process.execPath,tmpdir:temp,tmpdirIdentitySha256:createHash('sha256').update(temp).digest('hex'),explicitTmpdir:typeof env.TMPDIR==='string',cliPathOverride:env.JLCEDA_CLI_PATH??null,inspectionTempRoot:os.tmpdir()};
}
