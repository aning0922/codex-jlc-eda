import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, chmod, rm, cp, access } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport, getDefaultEnvironment } from '@modelcontextprotocol/sdk/client/stdio.js';
import { JlcEdaAdapter, runCommand } from '../src/adapter.mjs';
import { scripts } from '../src/native-scripts.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const projectUuid = 'project-test';
const pageUuid = 'page-test';
const pcbUuid = 'pcb-test';
const project = { uuid: projectUuid, name: '不同电路', data: [
  { itemType: 'Board', name: 'Board', schematic: { itemType: 'Schematic', uuid: 'sch-root',
    name: 'Schematic', page: [{ itemType: 'Schematic Page', uuid: pageUuid, name: 'P1' }] },
    pcb: { itemType: 'PCB', uuid: pcbUuid, name: 'PCB' } }
] };

test('invalid and extra input is rejected before touching the CLI', async () => {
  let calls = 0;
  const adapter = new JlcEdaAdapter({ executable: '/unused', runner: async () => { calls++; } });
  assert.equal((await adapter.dispatch('jlc_eda_read_document', {
    sessionId: 'a', expectedProjectUuid: 'b', documentUuid: 'c', kind: 'pcb', code: 'side_effect()'
  })).code, 'INVALID_INPUT');
  assert.equal((await adapter.dispatch('jlc_eda_inspect_project', { sessionId: '--bad value' })).code, 'INVALID_INPUT');
  assert.equal(calls, 0);
});

test('project discovery gives real document identities; mismatch is detected without drawing reads', async () => {
  const eda = { dmt_Project: { getCurrentProjectInfo: async () => project } };
  const result = await new AsyncFunction('eda', 'return await ' + scripts.project({}))(eda);
  assert.equal(result.project.uuid, projectUuid);
  assert.deepEqual(result.documents.map(d => d.uuid), ['sch-root', pageUuid, pcbUuid]);
  const mismatch = await new AsyncFunction('eda', 'return await ' + scripts.project({ expectedProjectUuid: 'wrong' }))(eda);
  assert.equal(mismatch.code, 'TARGET_MISMATCH');
  const empty = await new AsyncFunction('eda', 'return await ' + scripts.project({}))({
    dmt_Project: { getCurrentProjectInfo: async () => ({ uuid: projectUuid, data: [] }) }
  });
  assert.equal(empty.status, 'unknown');
  assert.equal(empty.code, 'PROJECT_TREE_NOT_READY_OR_EMPTY');
});

test('foreign document and wrong kind never activate an editor document', async () => {
  let activated = 0;
  const eda = {
    dmt_Project: { getCurrentProjectInfo: async () => project },
    dmt_EditorControl: { openDocument: () => { activated++; } }
  };
  for (const parameters of [
    { expectedProjectUuid: 'wrong', documentUuid: pcbUuid, kind: 'pcb' },
    { expectedProjectUuid: projectUuid, documentUuid: 'foreign', kind: 'pcb' },
    { expectedProjectUuid: projectUuid, documentUuid: pageUuid, kind: 'pcb' }
  ]) {
    const result = await new AsyncFunction('eda', 'return await ' + scripts.focus(parameters))(eda);
    assert.equal(result.status, 'failed');
  }
  assert.equal(activated, 0);
});

test('an existing tab is activated rather than reopened from disk', async () => {
  let activated = null, opened = false;
  const eda = {
    dmt_Project: { getCurrentProjectInfo: async () => project },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({ uuid: pageUuid, parentProjectUuid: projectUuid }) },
    dmt_EditorControl: {
      getSplitScreenTree: async () => ({ children: [{ tabs: [{ tabId: pcbUuid + '@' + projectUuid }] }] }),
      activateDocument: async id => { activated = id; return true; },
      openDocument: async () => { opened = true; }
    }
  };
  const result = await new AsyncFunction('eda', 'return await ' + scripts.focus({
    expectedProjectUuid: projectUuid, documentUuid: pcbUuid, kind: 'pcb'
  }))(eda);
  assert.equal(result.focusAction, 'activate_existing');
  assert.equal(activated, pcbUuid + '@' + projectUuid);
  assert.equal(opened, false);
});

test('a target switch while reading does not return an apparently valid inventory', async () => {
  let documentReads = 0;
  const eda = {
    dmt_Project: { getCurrentProjectInfo: async () => project },
    dmt_SelectControl: { getCurrentDocumentInfo: async () => ({
      uuid: ++documentReads === 1 ? pcbUuid : 'another', parentProjectUuid: projectUuid, documentType: 3
    }) },
    pcb_PrimitiveComponent: { getAll: async () => [] },
    pcb_PrimitiveLine: { getAll: async () => [] },
    pcb_PrimitiveVia: { getAll: async () => [] },
    pcb_PrimitivePolyline: { getAll: async () => [] }
  };
  const result = await new AsyncFunction('eda', 'return await ' + scripts.document({
    expectedProjectUuid: projectUuid, documentUuid: pcbUuid, kind: 'pcb', limit: 50, includePins: false
  }))(eda);
  assert.equal(result.code, 'TARGET_CHANGED_DURING_READ');
  assert.equal(result.counts, undefined);
});

test('offline editor prevents opening; CLI sessions owned by someone else cannot be detached', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jlc-test-'));
  try {
    const file = path.join(dir, '例子 board.eprj2'); await writeFile(file, 'fixture');
    const commands = [];
    const adapter = new JlcEdaAdapter({ inspectionRoot: dir, executable: '/unused', runner: async (_exe, args) => {
      commands.push(args); return { value: { connected: false }, diagnosticsPresent: false };
    } });
    assert.equal((await adapter.dispatch('jlc_eda_open_project', { path: file })).status, 'needs_ui');
    assert.deepEqual(commands, [['doctor']]);
    assert.equal((await adapter.dispatch('jlc_eda_close_session', { sessionId: 'foreign' })).code, 'SESSION_NOT_OWNED');
    assert.equal(commands.length, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('a successful open with failed metadata is returned as unknown with its session, without replay', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jlc-test-'));
  try {
    const file = path.join(dir, 'test.eprj2'); await writeFile(file, 'fixture');
    const commands = [];
    const adapter = new JlcEdaAdapter({ inspectionRoot: dir, executable: '/unused', runner: async (_exe, args) => {
      commands.push(args);
      if (args[0] === 'doctor') return { value: { connected: true } };
      if (args[0] === 'session' && args[1] === 'list') return { value: [] };
      if (args[0] === 'open') return { value: { sessionId: 'own-session', path: args[2] } };
      if (args[0] === 'invoke') throw new Error('native timeout');
      if (args[0] === 'session' && args[1] === 'close') return { value: { status: 'closed' } };
      throw new Error('Unexpected command');
    } });
    const result = await adapter.dispatch('jlc_eda_open_project', { path: file });
    assert.equal(result.status, 'unknown'); assert.equal(result.sessionId, 'own-session');
    assert.equal(commands.filter(c => c[0] === 'open').length, 1);
    assert.equal(result.resourceCleanup.editorWindowDestroyed,true);
    const close = await adapter.dispatch('jlc_eda_close_session', { sessionId: result.sessionId });
    assert.equal(close.code,'SESSION_NOT_OWNED');
    assert.ok(commands.some(c=>c.includes('--destroy')));
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('the adapter serializes commands which share an editor session', async () => {
  let active = 0, highWater = 0;
  const adapter = new JlcEdaAdapter({ executable: '/unused', runner: async () => {
    active++; highWater = Math.max(highWater, active);
    await new Promise(r => setTimeout(r, 20)); active--;
    return { value: { status: 'ok', project: { uuid: projectUuid } } };
  } });
  await Promise.all([1,2,3].map(() => adapter.dispatch('jlc_eda_inspect_project', {
    sessionId: 'a', expectedProjectUuid: projectUuid
  })));
  assert.equal(highWater, 1);
});

test('opening waits for project loading by repeating only metadata reads', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jlc-loading-'));
  try {
    const file = path.join(dir, 'loading.eprj2'); await writeFile(file, 'fixture');
    let opens = 0, reads = 0;
    const adapter = new JlcEdaAdapter({ inspectionRoot: dir, executable: '/unused', runner: async (_exe, args) => {
      if (args[0] === 'doctor') return { value: { connected: true } };
      if (args[0] === 'session') return { value: [] };
      if (args[0] === 'open') { opens++; return { value: { sessionId: 'loading-session', path: args[2] } }; }
      if (args[0] === 'invoke') return { value: ++reads === 1
        ? { status: 'unknown', code: 'NO_CURRENT_PROJECT' }
        : reads === 2 ? { status: 'unknown', code: 'PROJECT_TREE_NOT_READY_OR_EMPTY', project: { uuid: projectUuid } }
        : { status: 'ok', project: { uuid: projectUuid } } };
      throw new Error('Unexpected command');
    } });
    const result = await adapter.dispatch('jlc_eda_open_project', { path: file });
    assert.equal(result.status, 'ok'); assert.equal(result.project.uuid, projectUuid);
    assert.equal(opens, 1); assert.equal(reads, 3);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('CLI execution preserves quoted arguments without a shell and distinguishes timeout', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'jlc 空格-'));
  try {
    const program = path.join(dir, 'fake cli.mjs');
    await writeFile(program, "if(process.argv[2]==='hang')setInterval(()=>{},1000);else if(process.argv[2]==='bridge')console.log(JSON.stringify({ok:false,error:{code:'BRIDGE_NOT_READY',message:'render unavailable'}}));else console.log(JSON.stringify({ok:true,value:process.argv.slice(2)}));");
    const argument = '中文 "quoted" $(touch SHOULD_NOT_EXIST) ; $HOME';
    const result = await runCommand(process.execPath, [program, argument]);
    assert.deepEqual(result.value, [argument]);
    await assert.rejects(runCommand(process.execPath, [program, 'hang'], { timeoutMs: 100 }), e =>
      e.code === 'CLI_TIMEOUT' && e.status === 'unknown');
    await assert.rejects(runCommand(process.execPath, [program, 'bridge']), e =>
      e.code === 'BRIDGE_NOT_READY' && e.status === 'unknown');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('relocated bundle speaks MCP without node_modules or a fixed working directory', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'EDA 插件搬迁-'));
  let transport, client;
  try {
    const copy = path.join(dir, 'plugin with spaces');
    await cp(path.join(root, 'dist'), path.join(copy, 'dist'), { recursive: true });
    await cp(path.join(root, 'scripts/launch-mcp.sh'), path.join(copy, 'scripts/launch-mcp.sh'), { recursive: true });
    await cp(path.join(root,'skills'),path.join(copy,'skills'),{recursive:true});
    for(const reference of ['usage.md','passives.md','verified-history.md'])await access(path.join(copy,'skills/jlc-eda-project/references',reference));
    await assert.rejects(access(path.join(copy, 'node_modules')));
    const fake = path.join(dir, 'fake-editor.mjs');
    await writeFile(fake, '#!/usr/bin/env node\nconsole.log(JSON.stringify({ok:true,value:{connected:process.env.TMPDIR===' + JSON.stringify(dir) + ',versionMatch:null}}));\n');
    await chmod(fake, 0o755);
    const manifest = JSON.parse(await readFile(path.join(root, '.mcp.json'), 'utf8')).mcpServers.jlc_eda;
    const hostEnv = { ...process.env, TMPDIR: dir, JLCEDA_CLI_PATH: fake };
    const env = getDefaultEnvironment();
    for (const key of manifest.env_vars ?? []) if (hostEnv[key] !== undefined) env[key] = hostEnv[key];
    delete env.CODEX_MCP_NODE_PATH;
    transport = new StdioClientTransport({ command: '/bin/sh', args: [path.join(copy, 'scripts/launch-mcp.sh')],
      cwd: dir, env, stderr: 'pipe' });
    let diagnostics = ''; transport.stderr?.on('data', c => { diagnostics += c.toString(); });
    client = new Client({ name: 'p1-portability-test', version: '1.0.0' });
    await client.connect(transport);
    const list = await client.listTools();
    assert.equal(list.tools.length, 35);
    const incremental=list.tools.find(t=>t.name==='jlc_eda_incremental_pcb');
    assert.ok(incremental);
    assert.deepEqual([...incremental.inputSchema.required].sort(),['outputDirectory','phase','requestId','sourcePath']);
    assert.equal(incremental.inputSchema.additionalProperties,false);
    assert.deepEqual(incremental.inputSchema.properties.phase.enum,['derive','plan','apply','verify','finish','recover','prepare_model','inspect_model','adopt_model','repair_model_projection']);
    for(const key of ['sourcePath','outputDirectory','requestId','sourceCheckpointPath'])assert.equal(incremental.inputSchema.properties[key].type,'string');
    for(const key of ['sessionId','expectedProjectUuid','pcbDocumentUuid','code'])assert.equal(incremental.inputSchema.properties[key],undefined);
    const changes=incremental.inputSchema.properties.changes;
    assert.equal(changes.type,'object');assert.equal(changes.additionalProperties,false);
    assert.deepEqual(Object.keys(changes.properties).sort(),['addLines','addVias','labels','lineEdits','stencils','viaMoves']);
    assert.equal(changes.properties.stencils.items.properties.modelPolicy.const,'selected_instance');
    for(const key of ['viaMoves','addVias']){const point=changes.properties[key].items.properties[key==='viaMoves'?'from':'at'];assert.equal(Array.isArray(point.items),false);assert.equal(point.items.type,'number');assert.equal(point.minItems,2);assert.equal(point.maxItems,2);}
    assert.equal(incremental.annotations.destructiveHint,false);
    assert.equal(incremental.annotations.readOnlyHint,false);
    assert.equal(incremental.annotations.openWorldHint,false);
    assert.match(incremental.description,/完整保存重开与关闭/);
    const eco=list.tools.find(t=>t.name==='jlc_eda_schematic_eco');assert.ok(eco);
    assert.deepEqual([...eco.inputSchema.required].sort(),['outputDirectory','phase','requestId','sourceCheckpointPath','sourcePath']);
    assert.deepEqual(eco.inputSchema.properties.phase.enum,['derive','parts','read','plan','schematic','sync','verify_sync','complete','verify','finish','recover','preview','prepare_replace','adopt_replace','prepare_notes','adopt_notes']);
    assert.deepEqual(eco.inputSchema.properties.mode.enum,['single_point','passives','notes']);assert.equal(eco.inputSchema.properties.mode.default,'single_point');assert.equal(eco.inputSchema.properties.passiveChanges.additionalProperties,false);assert.equal(eco.inputSchema.properties.candidateSupplierIds.maxItems,4);
    assert.equal(eco.inputSchema.additionalProperties,false);assert.equal(eco.inputSchema.properties.addition.additionalProperties,false);
    for(const key of ['sessionId','expectedProjectUuid','pcbDocumentUuid','code'])assert.equal(eco.inputSchema.properties[key],undefined);
    assert.equal(eco.annotations.readOnlyHint,false);assert.equal(eco.annotations.destructiveHint,false);assert.equal(eco.annotations.openWorldHint,false);
    const manufacturing=list.tools.find(t=>t.name==='jlc_eda_export_manufacturing');
    assert.ok(manufacturing);
    assert.deepEqual([...manufacturing.inputSchema.required].sort(),['outputDirectory','requestId','sourcePath']);
    for(const key of ['sourcePath','outputDirectory','requestId'])assert.equal(manufacturing.inputSchema.properties[key].type,'string');
    assert.deepEqual(manufacturing.inputSchema.properties.phase.enum,['generate','verify','refresh_previews']);
    assert.equal(manufacturing.annotations.destructiveHint,false);
    assert.equal(manufacturing.annotations.readOnlyHint,false);
    assert.ok(list.tools.some(x=>x.name==='jlc_eda_stop_work_project'));
    assert.equal(list.tools.find(t => t.name === 'jlc_eda_read_document').annotations.readOnlyHint, false);
    const answer = await client.callTool({ name: 'jlc_eda_doctor', arguments: {} });
    assert.equal(answer.structuredContent.status, 'ok');
    assert.equal(answer.structuredContent.editorConnected, true);
    assert.equal(diagnostics, '');
  } finally { await client?.close(); await transport?.close(); await rm(dir, { recursive: true, force: true }); }
});
