import {ecoSchemas} from './eco.mjs';
import {incrementalSchemas} from './incremental.mjs';
import {manufacturingSchemas} from './manufacturing.mjs';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import {drawingSchemas} from './drawing.mjs';
import {pcbSchemas} from './pcb.mjs';
import {finishSchemas} from './finish.mjs';
import {p3Schemas} from './p3.mjs';
import {stoppingSchemas} from './stopping.mjs';
import {fileRoutingSchemas} from './file-routing.mjs';
import {continuationSchemas} from './continuation.mjs';
import {repairSchemas} from './local-repair.mjs';
import { JlcEdaAdapter, VERSION } from './adapter.mjs';

if (Number(process.versions.node.split('.')[0]) < 20) {
  process.stderr.write('jlc-eda requires Node.js 20 or newer.\n'); process.exit(1);
}
const identifier = { type: 'string', pattern: '^[a-zA-Z0-9_-]{1,128}$' };
const targetProperties = { sessionId: identifier, expectedProjectUuid: identifier };
const definitions = [
  ['jlc_eda_doctor', '检查嘉立创官方 CLI、版本和连接状态。读写能力与连接分别报告；界面自动化由宿主提供，不假定存在。', {}, [], true],
  ['jlc_eda_sessions', '列出官方 CLI 会话。不要把第一个会话默认为用户目标；普通编辑器窗口可能尚未注册。', {}, [], true],
  ['jlc_eda_open_project', '为指定已有工程创建隔离副本并打开检查，返回原件与副本路径、会话和文档身份。本版不打开原件；编辑器可能在副本写历史。同一来源未变时复用本服务已有活跃副本。', { path: { type: 'string' } }, ['path'], false],
  ['jlc_eda_inspect_project', '读取已选会话中的工程身份与文档目录。已知预期工程 UUID 时必须提供以核对目标；首次可仅发现身份，不修改编辑器。', targetProperties, ['sessionId'], true],
  ['jlc_eda_read_document', '读取指定原理图页或 PCB 的实例、子部件、镜像、位置和可选引脚/焊盘几何。可能激活标签页；逻辑网表另用 read_connectivity。图元边界不是已核验的机械尺寸。', {
    ...targetProperties, documentUuid: identifier, kind: { type: 'string', enum: ['schematic','pcb'] },
    includePins: { type: 'boolean', default: false }, includeGeometry: { type: 'boolean', default: false },
    limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 }
  }, ['sessionId','expectedProjectUuid','documentUuid','kind'], false],
  ['jlc_eda_search_devices', '通过当前工程的官方器件库搜索候选。query 关键词和 properties 属性条件二选一；返回真实库身份及参数来源，不验证实时库存、价格或电气适用性。', {
    ...targetProperties, query: { type: 'string', minLength: 3, maxLength: 160 }, libraryUuid: identifier,
    properties: { type: 'object', minProperties: 1, additionalProperties: false,
      properties: Object.fromEntries(['name','value','symbolName','footprintName','supplierFootprint','supplierId','partNumber','partCode']
        .map(key => [key, { type: 'string', minLength: 1, maxLength: 160 }])) },
    limit: { type: 'integer', minimum: 1, maximum: 25, default: 10 }, page: { type: 'integer', minimum: 1, maximum: 100, default: 1 }
  }, ['sessionId','expectedProjectUuid'], true],
  ['jlc_eda_read_device', '按搜索或实例返回的真实器件与库 UUID 读取详细参数、符号/封装关联、子部件和数据表链接。链接存在不代表已核对数据表。', {
    ...targetProperties, deviceUuid: identifier, libraryUuid: identifier
  }, ['sessionId','expectedProjectUuid','deviceUuid','libraryUuid'], true],
  ['jlc_eda_read_library_model', '打开或激活指定符号/封装库文档并读取原生端子几何、焊盘形状、原点和源指纹。官方 API 无法打开时返回 needs_ui，不制造模型数据。端子边界不是机械外形。', {
    ...targetProperties, modelUuid: identifier, libraryUuid: identifier, kind: { type: 'string', enum: ['symbol','footprint'] }
  }, ['sessionId','expectedProjectUuid','modelUuid','libraryUuid','kind'], false],
  ['jlc_eda_read_connectivity', '读取官方原理图逻辑网表及符号引脚；可与同板 PCB 焊盘的网络归属核对，按唯一 ID 合并多单元符号。comparison.status 才是核对结论；匹配不代表已布通、DRC 或功能通过。只支持单个原理图树，最多 8 页，每页 200 个实例。', {
    ...targetProperties, schematicPageUuid: identifier, pcbDocumentUuid: identifier
  }, ['sessionId','expectedProjectUuid','schematicPageUuid'], false],
  ['jlc_eda_close_session', '默认真实销毁本服务创建的临时读取上下文及窗口，保留文件；destroy=false 仅 detach（隐藏上下文原生仍销毁）。可写工作窗口必须用 finish_work_project 保存、独立重读并比较完整原生设计后关闭。', { sessionId: identifier,destroy:{type:'boolean',default:true} }, ['sessionId'], false]
];
const tools = definitions.map(([name, description, properties, required, readOnlyHint]) => ({
  name, description, inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint, destructiveHint: false, idempotentHint: readOnlyHint, openWorldHint: false }
}));
for(const [name,schema] of Object.entries(drawingSchemas))tools.push({name,description:({jlc_eda_create_work_project:'从原生空白模板创建独立任务工程；拒绝已有输出与非空模板。',jlc_eda_draw_schematic:'在明确绑定的任务工程按结构化器件与全引脚连接表绘制，记录逐步写入，未知结果不重放。',jlc_eda_verify_schematic:'逐项核对元件、属性、方向、全部 pin→net 与明确 NC；逻辑通过不等于电气或 ERC 通过。',jlc_eda_save_work_project:'仅保存绑定的任务工程，返回 unknown/PERSISTENCE_NOT_VERIFIED，须独立磁盘重读后才确认持久化。',jlc_eda_reopen_work_project:'从任务原生磁盘文件建立隔离的新读取会话，核对同一输入并报告持久化结果。',jlc_eda_preview_schematic:'导出绑定任务原理图的原生 SVG/PNG 预览。'})[name],inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:name==='jlc_eda_verify_schematic',destructiveHint:false,openWorldHint:false}});
const adapter = new JlcEdaAdapter();
for(const [name,schema] of Object.entries(continuationSchemas))tools.push({name,description:'从已保存并有布局检查点的正式任务建立明确续作副本，保留完整源 journal、旧未知动作及来源哈希；发现活跃目标或确认关闭后正式打开并核对原生身份、Board、模型、布局和铜线，不复用已关闭 sid。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
const pcbDescriptions={jlc_eda_derive_work_project:'从来源原生工程明确派生新的任务工作副本，核对原理图输入、真实封装后绑定。empty 为默认；synchronized_unrouted 必须给原生源及完整同步检查点，拒绝其他 PCB 内容，不改来源。',jlc_eda_sync_pcb:'在绑定的无布线任务 PCB 中调用官方原理图树导入，核对全部元件、真实封装与 pin→pad 网络。复核未应用时返回 needs_ui 并保持 PCB。重复请求只读回，未知导入不自动重放；verify 用于界面完成后核查。retry_unapplied_review 仅在首次复核已关闭且完整零影响读回时明确恢复一次，超时或部分应用拒绝。',jlc_eda_verify_pcb:'按真实 Board 关联、唯一 ID、器件/封装来源及模型全部焊盘核对 PCB。匹配不代表布局、铜线连通、ERC/DRC 或电气通过。',jlc_eda_reopen_pcb:'每次创建新磁盘副本和新读取上下文，全量重核原理图/PCB 及原有位置；只有 persistenceVerified=true 才确认保存。',jlc_eda_preview_pcb:'在绑定 PCB 导出当前原生渲染图；只改变选择/缩放，不布局或布线。'};
for(const [name,schema] of Object.entries(pcbSchemas))tools.push({name,description:pcbDescriptions[name],inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:name==='jlc_eda_verify_pcb',destructiveHint:false,openWorldHint:false}});
for(const [name,schema] of Object.entries(finishSchemas))tools.push({name,description:'收尾明确绑定的工作工程：未决写入保留；两端保存、现场核对、新磁盘上下文及完整原生设计比较通过后，真实关闭任务窗口并保留产物。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
const p3Descriptions={jlc_eda_read_pcb_routing:'读取绑定 PCB 的真实铜线/过孔/板框、规则和本机 API 声明。函数存在不代表路由运行成功。',jlc_eda_layout_pcb:'候选布局入口：以明确单位、板框和全实例约束生成计划，官方移动与板框写入后读回；保留同步历史并另建布局检查点。总体验收仍由独立复核决定。',jlc_eda_configure_pcb_rules:'候选规则入口：只更新当前任务 PCB 的间距/线宽/过孔数字，保留所有检查项及全局设置，并读回核对。总体验收仍由独立复核决定。',jlc_eda_route_pcb:'候选原生路由入口：真实焊盘关键线或受限网络原生引擎；保留已有铜线、限制图层和等待，未知结果不重放。prepare_ui 不运行引擎；verify 核对实际应用。总体验收仍由独立复核决定。',jlc_eda_check_pcb:'候选 PCB 检查入口：完整身份、布局、实际铜线图和新执行原生严格 DRC 分别报告。boardReady 要求全部通过。总体验收仍由独立复核决定。'};
for(const [name,schema] of Object.entries(p3Schemas))tools.push({name,description:p3Descriptions[name],inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:name==='jlc_eda_read_pcb_routing',destructiveHint:false,openWorldHint:false}});
for(const [name,schema] of Object.entries(stoppingSchemas))tools.push({name,description:'native_timeout 停止唯一未决原生超时路由；rolled_back_ui 保全成功观察后失效并完全回到运行前的 GUI 阶段。两端保存、原生全档案、新磁盘、原内容/归属保持核对后关闭；原成功路由基线和失败记录保留，operationSucceeded/designReady=false。关闭未知只读协调，不重发。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
for(const [name,schema] of Object.entries(fileRoutingSchemas))tools.push({name,description:name==='jlc_eda_export_pcb_dsn'?'正式绑定PCB的官方DSN单次导出，记录文件来源、完整前后档案和原生图元。':'同一DSN来源的受限SES计划/单次导入/只读验证；仅省略唯一对应既有protect过孔，独立报告原ID和严格共线覆盖。必须DRC、连通、切页和保存核验。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
for(const [name,schema] of Object.entries(manufacturingSchemas))tools.push({name,description:'从指定工程路径自动发现单板与文档，在新隔离读取上下文导出本地Gerber/BOM/贴片坐标和预览，解析实际文件并给出中文制造检查。源不改写、导出未知不重放；verify仅复核完整已捕获文件。文件生成与制造资格分别报告。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});

for(const [name,schema] of Object.entries(incrementalSchemas))tools.push({name,description:'从已有完成PCB正式派生新的增量工作副本，自动发现实际关联；局部孔/线/位号/工程内钢网封装的结构化计划、单次执行、非目标保持、严格DRC/铜连通、完整保存重开与关闭。源工程和原journal保持，不恢复已finish源或重放未知。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});

const server = new Server({ name: 'jlc-eda', version: VERSION }, { capabilities: { tools: {} } });
for(const [name,schema] of Object.entries(ecoSchemas))tools.push({name,description:'从完成工程正式派生单页已有PCB的受限原理图增量任务，默认单脚SMT或passives模式常规两脚R/C新增、真实兼容换料与有创建来源的一脚局部改接；原生器件管理器/导入复核、局部连接、完整非目标与工程内封装保持及保存重开。来源保持、参数冲突拒绝、未知动作不重放。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
for(const [name,schema] of Object.entries(repairSchemas))tools.push({name,description:'来源完整的已知部分阶段局部补线：显式路径与通孔，plan/apply/verify、当前障碍规则预检、原内容完整保存；每请求写一次，未知不重放。',inputSchema:zodToJsonSchema(schema,{$refStrategy:'none'}),annotations:{readOnlyHint:false,destructiveHint:false,openWorldHint:false}});
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async request => {
  const result = await adapter.dispatch(request.params.name, request.params.arguments ?? {});
  return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result,
    isError: result.status === 'failed' };
});
await server.connect(new StdioServerTransport());
let disposing=false;
async function cleanupAndExit(){if(disposing)return;disposing=true;try{await adapter.tail;await adapter.dispose();}finally{process.exit(0);}}
server.onclose=cleanupAndExit;
process.once('SIGINT',cleanupAndExit);process.once('SIGTERM',cleanupAndExit);
