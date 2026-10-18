import {ecoSchemas,ecoWorkflow} from './eco.mjs';
import {incrementalSchemas,incrementalWorkflow} from './incremental.mjs';
import {manufacturingSchemas,manufacturingWorkflow} from './manufacturing.mjs';
import { spawn } from 'node:child_process';
import { access, realpath, stat, readFile, mkdir, mkdtemp, copyFile } from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import {drawingSchemas} from './drawing.mjs';
import {workflow} from './workflow.mjs';
import {pcbSchemas,pcbWorkflow} from './pcb.mjs';
import {ResourceLedger,resourceIdentityScript,resourceAnchorPath} from './resources.mjs';
import {randomUUID} from 'node:crypto';
import {connectivityScript} from './reading.mjs';
import {finishSchemas,finishWorkflow} from './finish.mjs';
import {environmentIdentity} from './environment.mjs';
import {p3Schemas,p3Workflow} from './p3.mjs';
import {continuationSchemas,continuationWorkflow} from './continuation.mjs';
import {installedRoutingCapability} from './routing-capability.mjs';
import {stoppingSchemas,stoppingWorkflow} from './stopping.mjs';
import {ruleRecoveryWorkflow} from './rule-recovery.mjs';
import {fileRoutingSchemas,fileRoutingWorkflow} from './file-routing.mjs';
import {repairSchemas,repairWorkflow} from './local-repair.mjs';
import { scripts } from './native-scripts.mjs';
import { factsScript } from './native-facts.mjs';
import { normalizeDevice, parseNetlist, compareAssignments, summarizeModel, summarizeSourceModel } from './facts.mjs';

export const VERSION = '0.11.0-dev.a10';
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const session = { sessionId: id };
const target = { ...session, expectedProjectUuid: id };
const searchProperty = z.string().trim().min(1).max(160);
const searchProperties = z.object({ name: searchProperty.optional(), value: searchProperty.optional(),
  symbolName: searchProperty.optional(), footprintName: searchProperty.optional(), supplierFootprint: searchProperty.optional(),
  supplierId: searchProperty.optional(), partNumber: searchProperty.optional(), partCode: searchProperty.optional()
}).strict().refine(v => Object.keys(v).length > 0, 'Supply at least one search property.');
export const schemas = {
  ...drawingSchemas,
  ...pcbSchemas,
  ...finishSchemas,
  ...p3Schemas,
  ...continuationSchemas,
  ...stoppingSchemas,
  ...fileRoutingSchemas,
  ...repairSchemas,
  ...manufacturingSchemas,
  ...incrementalSchemas,
  ...ecoSchemas,
  jlc_eda_doctor: z.object({}).strict(),
  jlc_eda_sessions: z.object({}).strict(),
  jlc_eda_open_project: z.object({ path: z.string().min(1).max(4096) }).strict(),
  jlc_eda_inspect_project: z.object({ ...session, expectedProjectUuid: id.optional() }).strict(),
  jlc_eda_read_document: z.object({ ...target, documentUuid: id,
    kind: z.enum(['schematic', 'pcb']), includePins: z.boolean().default(false),
    includeGeometry: z.boolean().default(false), limit: z.number().int().min(1).max(200).default(50) }).strict(),
  jlc_eda_search_devices: z.object({ ...target, query: z.string().trim().min(3).max(160).optional(),
    properties: searchProperties.optional(), libraryUuid: id.optional(),
    limit: z.number().int().min(1).max(25).default(10), page: z.number().int().min(1).max(100).default(1)
  }).strict().refine(v => !!v.query !== !!v.properties, 'Supply query or properties, not both.'),
  jlc_eda_read_device: z.object({ ...target, deviceUuid: id, libraryUuid: id }).strict(),
  jlc_eda_read_library_model: z.object({ ...target, modelUuid: id, libraryUuid: id, kind: z.enum(['symbol','footprint']) }).strict(),
  jlc_eda_read_connectivity: z.object({ ...target, schematicPageUuid: id, pcbDocumentUuid: id.optional() }).strict(),
  jlc_eda_close_session: z.object({...session,destroy:z.boolean().default(true)}).strict()
};

export class AdapterError extends Error {
  constructor(code, message, status = 'failed') { super(message); this.code = code; this.status = status; }
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

export async function runCommand(executable, args, options = {}) {
  const { timeoutMs = 12000, maxBytes = 4 * 1024 * 1024, env = process.env } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env });
    let output = '', diagnostic = '', bytes = 0, failure, settled = false, killTimer,exitDrainTimer;
    const fail = error => {
      if (failure || settled) return;
      failure = error;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {child.kill('SIGKILL');child.stdout.destroy();child.stderr.destroy();if(!settled){settled=true;clearTimeout(timer);clearTimeout(exitDrainTimer);reject(failure);}}, 500);
      killTimer.unref();
    };
    const timer = setTimeout(() => fail(new AdapterError('CLI_TIMEOUT',
      'CLI exceeded the wait limit. Its editor-side action may still be running; inspect state before retrying.', 'unknown')), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', s => {
      bytes += Buffer.byteLength(s);
      if (bytes > maxBytes) fail(new AdapterError('CLI_OUTPUT_LIMIT', 'CLI output exceeded the bounded response size.', 'unknown'));
      else output += s;
    });
    child.stderr.on('data', s => { diagnostic = (diagnostic + s).slice(-4096); });
    child.on('error', error => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);
      reject(new AdapterError('CLI_START_FAILED', 'Cannot start the configured CLI: ' + error.code));
    });
    const finish=exitCode => {
      if (settled) return;
      settled = true; clearTimeout(timer); clearTimeout(killTimer);clearTimeout(exitDrainTimer);
      if (failure) { reject(failure); return; }
      let result;
      try { result = JSON.parse(output.trim()); }
      catch { reject(new AdapterError('CLI_INVALID_JSON', 'CLI did not return one valid JSON response.', 'unknown')); return; }
      if (!result || typeof result.ok !== 'boolean') {
        reject(new AdapterError('CLI_SCHEMA_UNSUPPORTED', 'CLI response does not match the supported envelope.', 'unknown')); return;
      }
      if (!result.ok || exitCode !== 0) {
        const code = result.error?.code || 'CLI_FAILED';
        const unknown = /TIMEOUT|CONNECTION|DISCONNECT|BRIDGE_NOT_READY/.test(code);
        reject(new AdapterError(code, String(result.error?.message || 'CLI command failed.').slice(0,1200), unknown ? 'unknown' : 'failed'));
        return;
      }
      resolve({ value: result.value, durationMs: result.durationMs ?? null, diagnosticsPresent: diagnostic.trim().length > 0 });
    };
    child.on('close',finish);
    // Electron descendants can retain pipe handles after the CLI process exits.
    // Drain buffered output briefly, then settle from the actual CLI exit instead
    // of waiting indefinitely for every descendant's inherited pipe to close.
    child.on('exit',exitCode=>{exitDrainTimer=setTimeout(()=>{child.stdout.destroy();child.stderr.destroy();finish(exitCode);},100);});
  });
}

export async function discoverExecutable(env = process.env, platform = process.platform) {
  const override = env.JLCEDA_CLI_PATH;
  if (override && !path.isAbsolute(override)) throw new AdapterError('INVALID_CLI_PATH', 'JLCEDA_CLI_PATH must be an absolute executable path.');
  const candidates = override ? [override] : platform === 'darwin' ? [
    '/Applications/嘉立创EDA(专业版).app/Contents/MacOS/LCEDA-Pro',
    path.join(env.HOME || '', 'Applications/嘉立创EDA(专业版).app/Contents/MacOS/LCEDA-Pro')
  ] : [];
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      if ((await stat(candidate)).isFile()) return await realpath(candidate);
    } catch {}
  }
  if (override) throw new AdapterError('CLI_NOT_FOUND', 'Configured JLCEDA_CLI_PATH is missing or not executable.', 'needs_input');
  throw new AdapterError(platform === 'darwin' ? 'CLI_NOT_FOUND' : 'PLATFORM_UNVERIFIED',
    'Set JLCEDA_CLI_PATH to the installed official CLI. Automatic discovery is currently verified on macOS.', 'needs_input');
}

async function getInstalledVersion(executable) {
  try {
    const file = path.resolve(path.dirname(executable), '../Resources/app/package.json');
    const info = JSON.parse(await readFile(file, 'utf8'));
    return typeof info.version === 'string' ? info.version : null;
  } catch { return null; }
}

export class JlcEdaAdapter {
  constructor({ env = process.env, platform = process.platform, runner = runCommand, executable,
    inspectionRoot = path.join(os.tmpdir(), 'codex-jlc-eda') } = {}) {
    this.env = {...env,TMPDIR:env.TMPDIR??os.tmpdir()}; this.platform = platform; this.runner = runner; this.executable = executable;
    this.ownedSessions = new Set(); this.openedPaths = new Map(); this.tail = Promise.resolve();
    this.inspectionRoot = inspectionRoot;
    this.resources=new ResourceLedger(inspectionRoot);
    this.callMetrics={cliProcessStarts:0,commands:{}};
  }

  dispatch(name, input = {}) {
    const job = this.tail.then(async () => {
      try {
        if (!schemas[name]) throw new AdapterError('UNKNOWN_TOOL', 'Unknown plugin tool.');
        const params = schemas[name].parse(input);
        const result = await this[name](params);
        const record=this.resources.entries.get(params.sessionId);
        const readTools=['jlc_eda_inspect_project','jlc_eda_read_document','jlc_eda_read_connectivity','jlc_eda_search_devices','jlc_eda_read_device','jlc_eda_read_library_model','jlc_eda_verify_schematic','jlc_eda_verify_pcb'];
        if(record?.kind==='inspection'&&readTools.includes(name)&&(['failed','unknown','unsupported'].includes(result.status)||['unknown','mismatch'].includes(result.comparison?.status)))result.resourceCleanup=await this.destroyOwnedSession(params.sessionId).catch(e=>({status:'unknown',code:e.code??'RESOURCE_CLEANUP_FAILED'}));
        return { pluginVersion: VERSION, observedAt: new Date().toISOString(), environment:environmentIdentity(this.env), ...result };
      } catch (e) {
        let resourceCleanup;
        if(this.resources.entries.get(input.sessionId)?.kind==='inspection'&&this.ownedSessions.has(input.sessionId))resourceCleanup=await this.destroyOwnedSession(input.sessionId).catch(x=>({status:'unknown',code:x.code??'RESOURCE_CLEANUP_FAILED'}));
        return { pluginVersion: VERSION, observedAt: new Date().toISOString(),
          status: e instanceof z.ZodError ? 'needs_input' : e.status || 'failed',
          code: e instanceof z.ZodError ? 'INVALID_INPUT' : e.code || 'ADAPTER_ERROR',
          ...(e.target?{target:e.target,executionRecord:e.executionRecord}:{}),
          ...(resourceCleanup?{resourceCleanup}:{}),
          message: e instanceof z.ZodError ? e.issues.map(i => i.path.join('.') + ': ' + i.message).join('; ') : e.message };
      }
    });
    this.tail = job.catch(() => {});
    return job;
  }

  async call(args, timeoutMs = 12000) {
    const executable = this.executable || await discoverExecutable(this.env, this.platform);
    this.callMetrics.cliProcessStarts++;this.callMetrics.commands[args[0]]=(this.callMetrics.commands[args[0]]??0)+1;
    return this.runner(executable, args, { env: this.env, timeoutMs });
  }

  async invoke(sessionId, code, timeoutMs=15000) {
    if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw new AdapterError('INVOKE_BUDGET_OUT_OF_RANGE','Native invoke budget must be an integer in [1, 180000] ms.');
    const nativeTimeoutMs=timeoutMs;
    const result = await this.call(['invoke', '--session', sessionId, '--ext-uuid', 'eda',
      '--timeout', String(nativeTimeoutMs), '--code', 'return await ' + code + ';'], nativeTimeoutMs+3000);
    if (!result.value || typeof result.value.status !== 'string')
      throw new AdapterError('NATIVE_SCHEMA_UNSUPPORTED', 'The native read returned an unexpected result.', 'unknown');
    return result.value;
  }

  async routingCapability(){return installedRoutingCapability(this.executable||await discoverExecutable(this.env,this.platform));}

  async invokeLossless(sessionId,code,timeoutMs=15000){
    const wrapped='(async()=>{const v=await '+code+';const text=JSON.stringify(v);if(typeof text!=="string")return {status:"unknown",code:"NATIVE_JSON_UNAVAILABLE"};return {status:"ok",nativeJsonAscii:text.replace(/[\\u007f-\\uffff]/g,c=>"\\\\u"+c.charCodeAt(0).toString(16).padStart(4,"0"))};})()';
    const r=await this.invoke(sessionId,wrapped,timeoutMs);
    if(r.status!=='ok'||typeof r.nativeJsonAscii!=='string')throw new AdapterError('NATIVE_ASCII_ENVELOPE_UNCONFIRMED','Lossless native envelope unavailable.','unknown');
    const value=JSON.parse(r.nativeJsonAscii);if(!value||typeof value.status!=='string')throw new AdapterError('NATIVE_SCHEMA_UNSUPPORTED','Native JSON result schema unavailable.','unknown');return value;
  }

  async jlc_eda_doctor() {
    const executable = this.executable || await discoverExecutable(this.env, this.platform);
    const installedVersion = await getInstalledVersion(executable);
    const response = await this.call(['doctor'],12000);
    const native = response.value;
    if (typeof native?.connected !== 'boolean') throw new AdapterError('DOCTOR_SCHEMA_UNSUPPORTED', 'Unrecognized CLI doctor response.', 'unknown');
    const routing=await this.routingCapability();
    return { status: native.connected ? 'ok' : 'needs_ui', publicToolCount:Object.keys(schemas).length, executable, installedVersion,
      platform: this.platform, nodeVersion: process.versions.node,
      editorConnected: native.connected, versionMatch: native.versionMatch ?? null,
      callMetrics:structuredClone(this.callMetrics),backgroundCalling:{transport:'official CLI; composed native reads',residentMcpSupportedOnValidatedClient:false},
      diagnosticsPresent: response.diagnosticsPresent,
      compatibility: { validatedClientFamily: 'macOS JLCEDA Pro; qualification is workflow-specific',
        currentVersionInValidatedFamily: this.platform === 'darwin' && (!!installedVersion?.startsWith('4.1.60.')||installedVersion==='4.1.71.7a7261be'),
        currentWorkflowQualification:installedVersion==='4.1.71.7a7261be'?'A6/A7 model reads, local project import, initial empty-board sync and full save verified; layout/routing require their own task evidence':'Consult the exact workflow evidence; no general client-family routing guarantee' },
      capabilities: { projectInspection: true, partsLibrary: true, logicalConnectivity: true,
        libraryGeometry: 'direct native model source with bounded supported geometry; legacy canvas fallback only when source API is unavailable',
        designMutation: true, autoRouting: {workflowAvailable:true,sdkDeclared:routing.sdkDeclared??null,installedBridgeRegistered:routing.installedBridgeRegistered??null,executionVerifiedByDoctor:false,qualification:'Static interface/bridge availability only; actual route, keep, copper, DRC and saved result are reported by the task workflow'},
        uiAutomation: 'host-dependent; not detectable or bundled by this MCP server' },
      nextAction: native.connected ? 'List sessions or open the project path requested by the user.'
        : 'Start the installed JLCEDA Pro desktop app, then run doctor again. No project has been opened.' };
  }

  async jlc_eda_sessions() {
    const response = await this.call(['session', 'list']);
    if (!Array.isArray(response.value)) throw new AdapterError('SESSIONS_SCHEMA_UNSUPPORTED', 'Session list was not an array.', 'unknown');
    return { status: 'ok', sessions: response.value.map(s => ({
      sessionId: s.sessionId, renderId: s.renderId ?? null, status: s.status,
      path: s.path ?? null, origin: s.origin ?? null, title: s.title ?? null,
      headless:typeof s.headless==='boolean'?s.headless:null,
      openedByThisService: this.ownedSessions.has(s.sessionId)
    })), note: 'Only official CLI sessions are listed. An editor window without a CLI session may still be open.' };
  }

  async jlc_eda_open_project(p) { return this.openInspectionProject(p); }

  async openInspectionProject(p,{fresh=false}={}) {
    if (!path.isAbsolute(p.path)) throw new AdapterError('PROJECT_PATH_NOT_ABSOLUTE', 'Provide an absolute existing project path.', 'needs_input');
    let sourcePath;
    try {
      sourcePath = await realpath(p.path);
      if (!(await stat(sourcePath)).isFile()) throw new Error('not a file');
    } catch { throw new AdapterError('PROJECT_NOT_FOUND', 'The requested project file does not exist.', 'needs_input'); }
    if (!/\.(eprj|eprj2|eprj3)$/i.test(sourcePath))
      throw new AdapterError('PROJECT_FORMAT_UNSUPPORTED', 'P1 opens existing .eprj, .eprj2 or .eprj3 project files.', 'unsupported');
    const readiness = await this.jlc_eda_doctor();
    if (readiness.status !== 'ok') return readiness;
    const before = await this.jlc_eda_sessions();
    const sourceSha256 = await hashFile(sourcePath);
    const prior = this.openedPaths.get(sourcePath);
    if (!fresh && prior && prior.sourceSha256 === sourceSha256 && before.sessions.some(s => s.sessionId === prior.sessionId && s.status === 'alive')) {
      const inspected = await this.jlc_eda_inspect_project({ sessionId: prior.sessionId, expectedProjectUuid: prior.projectUuid });
      return { ...inspected, sessionId: prior.sessionId, path: prior.path, sourcePath, sourceSha256,requestedRenderMode:'headless',
        inspectionCopy: true, openedByThisService: true, reusedOwnedSession: true, designMutationRequested: false };
    }
    // Even native read workflows can cause the editor to write project history.
    // Never open the caller's file directly in this inspection-only version.
    await mkdir(this.inspectionRoot, { recursive: true });
    const copyDirectory = await mkdtemp(path.join(this.inspectionRoot, 'read-'));
    const projectPath = await realpath(copyDirectory).then(dir => path.join(dir, path.basename(sourcePath)));
    await copyFile(sourcePath, projectPath, constants.COPYFILE_EXCL);
    if (await hashFile(projectPath) !== sourceSha256 || await hashFile(sourcePath) !== sourceSha256)
      throw new AdapterError('SOURCE_CHANGED_DURING_COPY', 'The source changed while creating its inspection copy. No editor open was requested.', 'unknown');
    const openingId='opening-'+randomUUID();
    await this.resources.register({sessionId:openingId,path:projectPath,sourcePath,sourceSha256,kind:'inspection',renderMode:'headless',beforeSessionIds:before.sessions.map(s=>s.sessionId)});
    await this.resources.update(openingId,{state:'opening'});
    let response;
    try { response = await this.call(['open','--path',projectPath,'--headless','true'],35000); }
    catch (e) { const resourceCleanup=await this.recoverInspectionOpening(openingId).catch(x=>({status:'unknown',code:x.code??'OPEN_RESOURCE_UNRESOLVED'}));return { status: e.status || 'unknown', code: e.code || 'OPEN_UNCONFIRMED', message: e.message,resourceCleanup,
      sourcePath, sourceSha256, path: projectPath, inspectionCopy: true,
      nextAction: 'Inspect the editor and sessions before retrying. Only the inspection copy was passed to the editor.' }; }
    const sid = response.value?.sessionId;
    if (!id.safeParse(sid).success || response.value?.path !== projectPath)
      throw new AdapterError('OPEN_RESULT_UNCERTAIN', 'The open result did not identify the requested file. Inspect the editor before retrying.', 'unknown');
    if(fresh&&before.sessions.some(s=>s.sessionId===sid))return {status:'unknown',code:'FRESH_SESSION_NOT_CREATED',sessionId:sid,path:projectPath,sourcePath,sourceSha256,inspectionCopy:true,freshDiskContext:false};
    if (!before.sessions.some(s => s.sessionId === sid)) this.ownedSessions.add(sid);
    if(this.ownedSessions.has(sid))await this.resources.register({sessionId:sid,path:projectPath,sourcePath,sourceSha256,kind:'inspection',renderMode:'headless',freshDiskContext:fresh});
    await this.resources.update(openingId,{state:'resolved',nativeSessionId:sid});
    if (!fresh && this.ownedSessions.has(sid)) this.openedPaths.set(sourcePath, { sessionId: sid, path: projectPath, sourceSha256 });
    // Opening and metadata reading are separate commands; no retry of the open action.
    try {
      const deadline = Date.now() + 15000;
      let inspected = await this.invoke(sid, scripts.project({}));
      while (['NO_CURRENT_PROJECT', 'PROJECT_TREE_NOT_READY_OR_EMPTY'].includes(inspected.code) && Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, 300));
        inspected = await this.invoke(sid, scripts.project({}));
      }
      if (!fresh && inspected.status === 'ok' && this.ownedSessions.has(sid))
        this.openedPaths.set(sourcePath, { sessionId: sid, projectUuid: inspected.project.uuid, path: projectPath, sourceSha256 });
      const resourceCleanup=inspected.status!=='ok'?await this.destroyOwnedSession(sid).catch(e=>({status:'unknown',code:e.code??'RESOURCE_CLEANUP_FAILED'})):null;
      return { ...inspected, ...(resourceCleanup?{resourceCleanup}:{}),sessionId: sid, path: projectPath, sourcePath, sourceSha256, inspectionCopy: true,
        openedByThisService: this.ownedSessions.has(sid), designMutationRequested: false,
        reusedOwnedSession:false,freshDiskContext:fresh,requestedRenderMode:'headless',
        fileSideEffects: 'The editor may write history or metadata in the inspection copy. The source file was not opened.',
        ...(inspected.status !== 'ok' ? {
          nextAction: 'The file was opened but its identity is not ready. Inspect this session; do not repeat open blindly.'
        } : {}) };
    } catch (e) {
      const resourceCleanup=await this.destroyOwnedSession(sid).catch(x=>({status:'unknown',code:x.code??'RESOURCE_CLEANUP_FAILED'}));
      return { status: 'unknown', code: 'OPENED_METADATA_UNAVAILABLE', sessionId: sid, path: projectPath,
        sourcePath, sourceSha256, inspectionCopy: true,
        openedByThisService: true,resourceCleanup,
        message: e.message, nextAction: 'The session was opened. Inspect this session; do not repeat open blindly.' };
    }
  }

  async jlc_eda_inspect_project(p) { return this.invoke(p.sessionId, scripts.project(p)); }

  async jlc_eda_search_devices(p) {
    const result = await this.invoke(p.sessionId, factsScript({ ...p, operation: 'search' }));
    if (result.status !== 'ok') return result;
    const { hits, ...summary } = result;
    return { ...summary, devices: hits.map(d => normalizeDevice(d, result.libraryUuid)),
      query: p.query ?? null, properties: p.properties ?? null,
      note: 'Search candidates are not an electrical recommendation. Verify parameters, model identity and datasheet separately.' };
  }

  async jlc_eda_read_device(p) {
    const result = await this.invoke(p.sessionId, factsScript({ ...p, operation: 'device' }));
    if (result.status !== 'ok') return result;
    return { status: 'ok', device: normalizeDevice(result.device, p.libraryUuid), source: result.source };
  }

  async jlc_eda_read_library_model(p) {
    const direct = await this.invoke(p.sessionId, factsScript({ ...p, operation: 'model_source' }));
    if (direct.status === 'ok') return summarizeSourceModel(direct);
    // Only an absent API permits the legacy canvas path. Bad source/identity
    // must not be concealed by opening another model window.
    if (direct.code !== 'MODEL_SOURCE_API_UNAVAILABLE') return direct;
    const focused = await this.invoke(p.sessionId, factsScript({ ...p, operation: 'model_focus' }));
    if (focused.status !== 'ok') return focused;
    for (let attempt = 0; attempt < 4; attempt++) {
      const result = await this.invoke(p.sessionId, factsScript({ ...p, operation: 'model_read' }));
      if (result.code !== 'MODEL_NOT_READY_OR_CHANGED') return result.status === 'ok'
        ? { ...summarizeModel(result), focusAction: focused.focusAction } : result;
      if (attempt < 3) await new Promise(resolve => setTimeout(resolve, 250));
    }
    return { status: 'unknown', code: 'MODEL_NOT_READY_OR_CHANGED', target: p };
  }

  async jlc_eda_read_connectivity(p) {
    const result=await this.invokeLossless(p.sessionId,connectivityScript(p));
    if(result.status!=='ok')return result;
    const netlist=parseNetlist(result.raw.source,p.expectedProjectUuid);
    if(parseNetlist(result.after.source,p.expectedProjectUuid).sourceSha256!==netlist.sourceSha256)return {status:'unknown',code:'NETLIST_CHANGED_DURING_READ'};
    return {status:'ok',projectUuid:result.projectUuid,schematicUuid:result.schematicUuid,scope:result.scope,sourceApi:result.raw.sourceApi,netlist,comparison:compareAssignments(netlist,result.schematic,result.pcb),coverage:{saveRun:false,schematicNetlistStableAcrossRead:true,atomicEditorSnapshot:false,officialInvokeCount:1,note:'Matching assignments do not prove DRC, copper continuity or circuit functionality.'}};
  }

  async jlc_eda_read_document(p) {
    return this.invokeLossless(p.sessionId,scripts.focusedDocument(p));
  }

  async jlc_eda_close_session(p) {
    if (!this.ownedSessions.has(p.sessionId)) return { status: 'failed', code: 'SESSION_NOT_OWNED',
      message: 'This service did not create the session. It will not detach another session.' };
    if(p.destroy)return this.destroyOwnedSession(p.sessionId);
    const result = await this.call(['session', 'close', '--session', p.sessionId]);
    if (result.value?.status !== 'closed') return { status: 'unknown', code: 'DETACH_NOT_CONFIRMED' };
    this.ownedSessions.delete(p.sessionId);
    for (const [key, value] of this.openedPaths) if (value.sessionId === p.sessionId) this.openedPaths.delete(key);
    const destroyed=result.value.headless===true;
    await this.resources.update(p.sessionId,{state:destroyed?'destroyed':'detached',closedAt:new Date().toISOString()});
    return { status: 'ok', sessionId: p.sessionId, sessionDetached: true,
      editorWindowDestroyed:destroyed,note:destroyed?'Native headless close destroyed its render.':'Explicit detach preserves the visible window.' };
  }

  async registerWorkSession(info){this.ownedSessions.add(info.sessionId);return this.resources.register({...info,kind:'work',renderMode:info.renderMode??'visible'});}
  async ensureWorkWindowBudget({exceptSessionId}={}){
    const live=await this.jlc_eda_sessions(),records=await this.resources.all();
    const active=records.filter(r=>r.sessionId!==exceptSessionId&&r.kind==='work'&&r.renderMode==='visible'&&r.state==='active'&&live.sessions.some(s=>s.sessionId===r.sessionId&&s.status==='alive'));
    if(active.length)throw new AdapterError('VISIBLE_WORK_WINDOW_LIMIT','Finish the existing saved work target before opening another visible task window.','needs_input');
  }
  async destroyOwnedSession(sessionId,{workVerified=false}={}){
    if(!this.ownedSessions.has(sessionId))return {status:'failed',code:'SESSION_NOT_OWNED'};
    const record=this.resources.entries.get(sessionId);
    if(record?.kind==='work'&&!workVerified)return {status:'unknown',code:'WORK_FINISH_REQUIRED',nextAction:'Use finish_work_project to save, compare live/disk state and close the exact task.'};
    const result=await this.call(['session','close','--session',sessionId,'--destroy']);
    if(result.value?.status!=='closed')return {status:'unknown',code:'DESTROY_NOT_CONFIRMED'};
    const sessions=await this.jlc_eda_sessions();
    if(sessions.sessions.some(s=>s.sessionId===sessionId&&s.status==='alive'))return {status:'unknown',code:'DESTROY_SESSION_STILL_ALIVE'};
    this.ownedSessions.delete(sessionId);for(const [k,v] of this.openedPaths)if(v.sessionId===sessionId)this.openedPaths.delete(k);
    await this.resources.update(sessionId,{state:'destroyed',closedAt:new Date().toISOString(),nativeClose:result.value});
    return {status:'ok',sessionId,sessionDetached:true,editorWindowDestroyed:true,nativeDestroyRequested:true,sessionNoLongerAlive:true,scope:'only the owned native session; files retained'};
  }
  async dispose(){const cleanup=[],retained=[];for(const sessionId of [...this.ownedSessions]){
    const record=this.resources.entries.get(sessionId);if(record?.kind==='work'){retained.push({sessionId,reason:'Work requires verified save/finish; unknown writes are never discarded.'});continue;}
    try{cleanup.push(await this.destroyOwnedSession(sessionId));}catch(e){cleanup.push({sessionId,status:'unknown',code:e.code??'RESOURCE_CLEANUP_FAILED'});}
  }for(const r of this.resources.entries.values())if(r.state==='opening'){
    try{cleanup.push(await this.recoverInspectionOpening(r.sessionId));}catch(e){retained.push({openingId:r.sessionId,status:'unknown',code:e.code??'OPEN_RESOURCE_UNRESOLVED'});}
  }return {cleanup,retained};}
  async recoverInspectionOpening(openingId){
    const record=this.resources.entries.get(openingId);if(!record||record.kind!=='inspection'||record.state!=='opening')return {status:'not_needed'};
    const listed=await this.jlc_eda_sessions(),candidates=listed.sessions.filter(s=>s.status==='alive'&&!record.beforeSessionIds.includes(s.sessionId));
    const matched=[];
    for(const s of candidates.slice(0,8)){
      let identity;try{identity=await this.invoke(s.sessionId,resourceIdentityScript);}catch{continue;}
      const reported=resourceAnchorPath(identity.anchor);if(identity.status==='ok'&&reported===record.path)matched.push(s);
    }
    if(matched.length!==1)return {status:'unknown',code:'OPEN_RESOURCE_IDENTITY_UNRESOLVED',openingId,matchedContexts:matched.length,nextAction:'Inspect the recorded copy path; no open or uncertain context is replayed/destroyed.'};
    const s=matched[0];this.ownedSessions.add(s.sessionId);await this.resources.register({...record,sessionId:s.sessionId,state:'active',recoveredFromOpening:openingId});
    await this.resources.update(openingId,{state:'resolved',nativeSessionId:s.sessionId});return this.destroyOwnedSession(s.sessionId);
  }
}

Object.assign(JlcEdaAdapter.prototype,workflow);
Object.assign(JlcEdaAdapter.prototype,pcbWorkflow);
Object.assign(JlcEdaAdapter.prototype,finishWorkflow);

Object.assign(JlcEdaAdapter.prototype,p3Workflow);
Object.assign(JlcEdaAdapter.prototype,continuationWorkflow);
Object.assign(JlcEdaAdapter.prototype,ruleRecoveryWorkflow);

Object.assign(JlcEdaAdapter.prototype,stoppingWorkflow);
Object.assign(JlcEdaAdapter.prototype,fileRoutingWorkflow);
Object.assign(JlcEdaAdapter.prototype,repairWorkflow);

Object.assign(JlcEdaAdapter.prototype,manufacturingWorkflow);

Object.assign(JlcEdaAdapter.prototype,incrementalWorkflow);
Object.assign(JlcEdaAdapter.prototype,ecoWorkflow);
