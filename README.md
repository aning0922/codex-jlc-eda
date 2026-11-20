![Codex JLC EDA · 嘉立创 EDA 专业版本地插件，封面为四层 PCB 分层示意](docs/assets/workflow.svg)

**简体中文** · [English](README.en.md)　｜　[用法](#怎么使用) · [35 个工具](#工具目录) · [安装](#快速开始) · [案例](#工程实测)

# 在 Codex 中使用嘉立创 EDA 专业版

告诉 Codex 工程位置和改动目标，例如“把滤波电容换成 100 nF，保留原有走线”。插件通过 **35 个本地 MCP 工具**读取真实器件，在副本上修改原理图与 PCB，保存后从磁盘重开，核对引脚、焊盘和铜连接。

**开发源码** `0.11.0-dev.a31-r4` · **预编译运行包** [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) · **许可** [MIT](LICENSE)

## 怎么使用

以下用法对应开发版 A31-r4。在启用了插件的 Codex 聊天中直接描述任务，把示例路径换成自己的绝对路径。工程、图页和焊盘的内部 ID 由助手从编辑器读取。

### 查一个已有工程

> 用嘉立创 EDA 助手打开 `/absolute/path/to/rc/work.eprj2` 的只读副本。列出图页，告诉我 C1 每个脚的脚号、网名，以及对应 PCB 焊盘的网络是否一致。完成后关闭检查副本。

`jlc_eda_open_project` 返回图页和 PCB 目录。助手用 `jlc_eda_read_connectivity` 比对同一块板的原理图与焊盘，按位号提取 C1 的引脚，再用 `jlc_eda_close_session` 关闭自己打开的副本。要看焊盘形状，可追加一句“读取该 PCB 的焊盘几何”。

### 查一个替换料号

> 在这份 RC 工程的器件库里找 100 nF、0603 的无极性 MLCC。列出候选料号、能查到的耐压和数据表链接，再对照 C1 的实际封装检查焊盘编号和尺寸。先给我候选清单。

`jlc_eda_search_devices` 返回候选身份，`jlc_eda_read_device` 取得该器件关联的符号与封装，`jlc_eda_read_library_model` 用 `view="geometry"` 读取实际焊盘。选料时逐脚核对焊盘号、形状和尺寸。

### 从空白模板画一块 RC 板

> 从 `/absolute/path/to/blank.eprj2` 的空白模板开始，把新工程放到 `/absolute/path/to/rc-first`。按仓库 RC 示例绘制 1 kΩ 串联电阻、10 nF 对地电容、100 kΩ 泄放电阻、输入输出连接器和三个测试点。完成同步、布局和布线，告诉我三个网是否全部布通，并给出保存重开结果。

先用 `jlc_eda_create_work_project` 建立工作副本。`jlc_eda_draw_schematic` 先 `place` 读取实际引脚，再 `complete` 连线。原理图核对通过后，用 `jlc_eda_sync_pcb` 同步 PCB。布局、规则和走线完成后，`jlc_eda_check_pcb` 检查铜连接和严格 DRC，`jlc_eda_finish_work_project` 保存并验证磁盘副本。[RC 需求与全部连接](examples/rc-filter/README.md)

### 在已完成的小板上换料并导出

> 用已完成的 RC 板 `/absolute/path/to/rc-first/work.eprj2` 和同目录的 `work-project.json`，在新的 `/absolute/path/to/rc-100nf` 副本中把 C1 从 10 nF 换成兼容封装的 100 nF 实际器件。保留其余器件与原走线，核对 BOM、网表和保存结果，再把 Gerber、BOM、贴片坐标导出到新的 `/absolute/path/to/rc-fab` 目录。

这里用 `jlc_eda_schematic_eco` 的 `mode="passives"`。助手核对候选器件和封装，按 `prepare_replace`、原生选料、`adopt_replace` 完成替换，再核对 PCB 同步与保存结果。选料需要可见窗口，派生副本时使用 `renderMode="visible"`。最后用 `jlc_eda_export_manufacturing` 生成本地文件并返回报告路径。[阻容修改的完整步骤](skills/jlc-eda-project/references/passives.md)

接入自己的 MCP 客户端时，可以直接使用[带参数的调用示例](#mcp-调用示例)，或按任务查找[全部 35 个工具](#工具目录)。

## 工程实测

### 四层控制板 · 接着已有走线完成一批信号网

从已有走线的 STM32H563 控制板派生副本后，**37 个目标信号网**共消除 74 处断点。在 EDA Pro 4.1.105 中保存并重开工程，核对了 **12 页原理图、265 个器件、161 个命名网络和 887 项逻辑引脚分配**。

| 检查项目 | 实机结果 |
|---|---|
| 全板铜连接 | 计入本阶段的供电和回流走线后，待连数从 **487 降到 348**。原有铜连通组均保留。 |
| 制造数据复核 | 从四层 Gerber 铜层与镀通钻孔重建焊盘连通组，**161/161 个网**与编辑器回读一致。 |
| 严格设计规则检查（DRC） | **480 个未连标记**，短路 0 项，间距违规 0 项。整板仍需继续布线。 |

新启动的 Codex 宿主加载了 A31-r4，以只读方式重开最终工程并关闭检查副本。[验收记录](docs/validation.md)

想在已验收局部布线的工作副本上增页，可以这样交代任务。将方括号里的内容换成工程上实际的位号、脚号和网名。

> 从这块板及其 `work-project.json` 派生新副本，新增“传感器接口”图页。将旧页已登记待接的 [位号和脚号] 接入新页的 [网名和器件脚号]，新增贴片件放到底面。保存重开后核对跨页网表、原有铜线和剩余待连数。

这个任务使用 `jlc_eda_schematic_eco` 的 `mode="add_page"`。`pageAddition.sourcePins` 指定旧页网表与 PCB 上核实过的待接引脚，`pageAddition.placements` 指定新增器件的位置和板面。[增页与底面放件](skills/jlc-eda-project/references/usage.md)

### RC 滤波板 · 换一颗电容并验证原有走线

![RC 滤波示意图。R1 串联在输入与输出之间，C1 和 R2 从输出接地，C1 从 10 nF 换为 100 nF。](docs/assets/rc-filter.svg)

在 EDA Pro 4.1.71 中，从空白双层板完成绘图、首次 PCB 同步、布局和布线。随后由已保存的成品派生副本，将 C1 换为封装兼容的 **100 nF** 实际料号，并核对 BOM。

| 规模 | 铜连接与规则 | 交付检查 |
|---|---|---|
| 8 个器件、13 个引脚、3 个网 | 3 个网全部布通，21 段走线、0 过孔，严格 DRC 为 0 | 换料后原有走线通过磁盘回读，41 个制造文件通过检查 |

图中连接来自公开需求表。这个案例完成了文件级验收，装配方向、3D 配合和样板性能仍待验证。[复现步骤与连接表](examples/rc-filter/README.md) · [开发进展](docs/development-status.md)

## 快速开始

需要 **macOS、Node.js 20 或更高版本、嘉立创 EDA 桌面专业版**，以及支持本地插件的 Codex。下方的多页、四层板和 RC 换料案例使用开发构建。若要复现这些流程，请选择源码版。

<details>
<summary><strong>从源码构建 A31-r4</strong> · 多页设计、四层板和局部布线</summary>

在新目录克隆仓库。`npm run check` 会构建插件、运行离线及协议检查，并生成运行包。

```sh
git clone https://github.com/aning0922/codex-jlc-eda.git
cd codex-jlc-eda
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-dev.a31-r4") process.exit(1)' &&
  npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund &&
  npm --prefix "$PROJECT_ROOT" run check
```

成功后校验两个 ZIP，并进入解包后的 runtime 目录。

```sh
cd "$PROJECT_ROOT/release/0.11.0-dev.a31-r4" &&
  shasum -a 256 -c SHA256SUMS &&
  unzip -q codex-jlc-eda-0.11.0-dev.a31-r4-runtime.zip -d runtime &&
  cd runtime
```

</details>

<details>
<summary><strong>下载 Alpha.3 运行包</strong> · 免构建的早期社区预览</summary>

Alpha.3 发布于 2026-10-10，早于 A6–A31 的开发工作。将两个文件下载到同一个空目录，在该目录中校验并解包。[runtime ZIP](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/codex-jlc-eda-0.11.0-alpha.3-runtime.zip) · [SHA256SUMS](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/SHA256SUMS)

```sh
runtime_zip=codex-jlc-eda-0.11.0-alpha.3-runtime.zip
awk -v name="$runtime_zip" '$2 == name' SHA256SUMS | shasum -a 256 -c - &&
  unzip -q "$runtime_zip" -d runtime &&
  cd runtime
```

此包自带依赖，包括 `fflate 0.8.3` 与 MCP SDK `1.31.0`。[依赖审计](docs/dependency-security.md)

</details>

**安装到 Codex。** 在上面选定的 runtime 解包根目录执行以下命令。该目录包含 `.agents/` 和 `plugins/`，安装后请保留。

```sh
codex plugin marketplace add "$PWD"
codex plugin add jlc-eda@jlc-eda-alpha --json
codex plugin list --marketplace jlc-eda-alpha --json
```

打开嘉立创 EDA，在新 Codex 聊天中做第一次只读检查。

> 使用嘉立创 EDA 助手检查环境，告诉我当前加载的插件版本、可用工具数，以及是否已连接编辑器。

预期结果是所选版本、**35** 项工具和 `editorConnected=true`。若仍报告旧版，检查是否启用了两个同名来源，再重新加载宿主。若 EDA 安装在非默认位置，将 `JLCEDA_CLI_PATH` 指向官方 CLI 可执行文件。Node 路径可通过 `CODEX_MCP_NODE_PATH` 指定。[本地插件安装说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

## MCP 调用示例

自配 MCP 客户端时，从插件目录启动 `/bin/sh ./scripts/launch-mcp.sh`，按配置传递 `PATH`、`TMPDIR` 和已设置的路径覆盖项。在**同一个已初始化的 stdio 连接**上，用 `tools/list` 查看运行中的工具及输入定义。下面的 JSON 是每次 `tools/call` 的 `params`，结果读 `structuredContent`。只想在终端检查环境时，可在已构建的源码根目录运行 `node dist/cli.mjs doctor`。[启动配置](.mcp.json)

**1. 打开检查副本。** 将路径换成现有工程文件。等到 `status="ok"` 和 `inspectionCopy=true`，再使用返回的标识。

```json
{
  "name": "jlc_eda_open_project",
  "arguments": { "path": "/absolute/path/to/rc/work.eprj2" }
}
```

**2. 读取引脚与焊盘的网络。** 把 `SESSION_FROM_OPEN` 换成上一步的 `sessionId`，`PROJECT_FROM_OPEN` 换成 `project.uuid`。从 `boards` 中按名称选中目标板，使用该板的 `pcbDocumentUuid`，并从它的 `schematicPageUuids` 中选取目标图页。`documents` 可按页名查 UUID。

```json
{
  "name": "jlc_eda_read_connectivity",
  "arguments": {
    "sessionId": "SESSION_FROM_OPEN",
    "expectedProjectUuid": "PROJECT_FROM_OPEN",
    "schematicPageUuid": "PAGE_FROM_BOARD",
    "pcbDocumentUuid": "PCB_FROM_BOARD"
  }
}
```

在 `netlist.components` 中找到 `designator="C1"`，读其 `pins` 中的 `number` 和 `net`。以下摘自 RC 示例在 EDA Pro 4.1.105 上的只读回读结果。

```text
netlist.counts       {"components":8,"pins":13,"namedNets":3}
C1                   1 → OUT    2 → GND
comparison.status    matched
```

`matched` 表示原理图引脚与 PCB 焊盘的网络分配一致。物理走线和严格 DRC 由绑定工作副本上的 `jlc_eda_check_pcb` 检查。

**3. 关闭这个读取会话。** 读取完成或中途出错时，用打开副本时返回的同一个 `sessionId` 清理。持续多步调用时请保留 MCP 连接，单次命令行调用退出时会回收其读取会话。

```json
{
  "name": "jlc_eda_close_session",
  "arguments": { "sessionId": "SESSION_FROM_OPEN" }
}
```

<details>
<summary><strong>另一条直接调用示例 · 导出已保存的成品</strong></summary>

将 `sourcePath` 指向已完成的 `.eprj2` 文件，`outputDirectory` 使用新的空目录。这个调用会写入本地交付文件。

```json
{
  "name": "jlc_eda_export_manufacturing",
  "arguments": {
    "sourcePath": "/absolute/path/to/rc-100nf/work.eprj2",
    "outputDirectory": "/absolute/path/to/rc-fab",
    "requestId": "rc-fab-01",
    "phase": "generate"
  }
}
```

结果中的 `reportPath` 和 `manifestPath` 分别指向制造检查报告和文件清单。`deliveryGenerated` 表示文件是否已生成并通过文件检查，`manufacturingReady` 单独报告制造资格。已有完整捕获需要复核时，沿用同一组参数和 `requestId`，改用 `phase="verify"`。

</details>

## 工具目录

以下是 **A31-r4 的全部 35 个 MCP 工具**。工程读取使用当前服务返回的会话与工程身份。绑定工作副本的工具还会用到 `workDirectory` 和同一块板的图页、原理图及 PCB 身份。`circuit` 是根据实际器件、引脚和连接整理的结构化输入。需要 `requestId` 时，同一动作和它的复核沿用原 ID。完整必填字段与枚举可从运行中的 `tools/list` 取得。[A31-r4 输入定义](https://github.com/aning0922/codex-jlc-eda/blob/527b42efa9a6ffdeb59b6e27c9fbfc5a44c6e936/tests/fixtures/public-tools.json)

### 环境与工程检查 (7)

- `jlc_eda_doctor` — 传 `{}` 查看插件版本、工具数和编辑器连接。先看 `pluginVersion`、`publicToolCount`、`editorConnected`。
- `jlc_eda_sessions` — 传 `{}` 列出官方 CLI 会话。用 `path`、`headless` 和 `openedByThisService` 辨认目标窗口。
- `jlc_eda_open_project` — 传工程文件的绝对 `path`。打开隔离检查副本，返回 `sessionId`、`project.uuid`、`boards` 和 `documents`。
- `jlc_eda_inspect_project` — 传选定的 `sessionId` 查询板和图页目录。已有预期工程身份时加 `expectedProjectUuid`，核对会话仍指向目标工程。
- `jlc_eda_read_document` — 传 `documentUuid` 和 `kind`（`schematic` 或 `pcb`）。`includePins=true` 读取脚号，`includeGeometry=true` 读取几何。输出标记 `truncated` 时检查 `limit`。
- `jlc_eda_read_connectivity` — 传 `schematicPageUuid` 读逻辑网表。再传同板的 `pcbDocumentUuid`，即可检查 `comparison.status` 和引脚到焊盘的归属差异。
- `jlc_eda_close_session` — 传检查副本返回的 `sessionId`，回收本服务的读取窗口。查看 `sessionNoLongerAlive` 确认默认关闭操作完成。

### 器件与库模型 (3)

- `jlc_eda_search_devices` — 用关键词 `query`（至少 3 个字符）或 `properties` 属性条件搜索，可用 `limit`、`page` 分页。从 `devices` 取候选的 `uuid` 和 `libraryUuid`。
- `jlc_eda_read_device` — 把候选的 `uuid` 作为 `deviceUuid`，并传 `libraryUuid`。读取参数、料号及关联的符号和封装身份。
- `jlc_eda_read_library_model` — 传模型的 `modelUuid`、`libraryUuid` 和 `kind`（`symbol` 或 `footprint`）。`view="geometry"` 查引脚或焊盘形状，`view="source"` 查原生模型来源。

### 工作副本与原理图 (8)

- `jlc_eda_create_work_project` — 给 `blankTemplatePath`、新 `outputDirectory` 和 `requestId`，从已核实的空模板建立可写副本。另可选择 `projectImport` 导入官方交换文件，得到独立导入结果。
- `jlc_eda_derive_work_project` — 传 `sourcePath`、`circuit`、新目录和请求 ID，从已有原理图派生工作副本。接续已同步未布线的 PCB 时，设 `sourcePcbState="synchronized_unrouted"` 并提供匹配的 `sourceCheckpointPath`。
- `jlc_eda_resume_work_project` — 已有保存的布局检查点时，传 `sourceWorkDirectory`、新 `outputDirectory`、`requestId` 和原 `circuit`。返回新副本的会话、文档身份和保留的动作记录。
- `jlc_eda_draw_schematic` — 传工作副本、`circuit` 和绘图 `requestId`。先用 `phase="place"` 放件并读取脚位，再用同一 ID 的 `complete` 连线。`tidy` 可整理已记录的标注。
- `jlc_eda_verify_schematic` — 传预期的 `circuit` 与图页身份，多页核对可传 `schematicPageUuids`。从 `comparison` 查器件、引脚网络和显式 NC 的差异。
- `jlc_eda_preview_schematic` — 传目标图页和 `workDirectory`，可设 `format="png"` 或 `"svg"`。返回生成预览的本地 `path`。
- `jlc_eda_save_work_project` — 向已绑定的副本提交保存请求。保存原理图与 PCB 时一并提供 `schematicUuid` 和 `pcbDocumentUuid`，随后用对应的重开工具核对持久化。
- `jlc_eda_reopen_work_project` — 用原 `workDirectory`、图页身份和 `circuit` 从磁盘复查单页原理图。查看 `persistenceVerified`。

### PCB 同步、布局与布线 (9)

- `jlc_eda_sync_pcb` — 传同板文档身份、`workDirectory`、`circuit` 与 `requestId`。默认先 `apply`，在指定 PCB 窗口复核导入，再以同一请求 `verify`。
- `jlc_eda_verify_pcb` — 传 `circuit` 及其原理图和 PCB 身份。按器件唯一标识、真实封装和焊盘网络核对同步结果。
- `jlc_eda_preview_pcb` — 传已绑定的 PCB 身份与 `workDirectory`，导出当前原生板图。返回 `path` 和 `mimeType`。
- `jlc_eda_reopen_pcb` — 传原工作副本参数和 `circuit`，从新的磁盘读取上下文重核原理图、PCB 与已有位置。看 `persistenceVerified`。
- `jlc_eda_read_pcb_routing` — 传正式工作副本的 `workDirectory` 和同板文档身份，读取板框、实际线段、过孔及规则。用于查现有铜线。
- `jlc_eda_layout_pcb` — 把板框、安装孔和器件位置放进 `layout`，按 `plan → apply → verify` 核对布局。`strategy` 可选 `manual`（手工约束）、`auto_candidate`（官方候选）或 `adjust`（候选调整）。
- `jlc_eda_configure_pcb_rules` — 传 `rules`，以毫米给出间距、线宽和过孔约束。`apply` 后以 `verify` 读回当前任务板的规则。
- `jlc_eda_route_pcb` — 单条关键线用 `phase="critical"` 和 `critical`。多条指定连接用 `phase="batch"` 和 `batch`，实心覆铜用 `plane`。分别以 `verify` 或 `verify_plane` 核对实际新增铜。
- `jlc_eda_check_pcb` — 传已绑定的 PCB 和 `circuit`，运行严格 DRC 并计算实际铜连接。分别看 `copper.remainingConnections`、`drc` 和 `boardReady`。

### 已有设计修改与布线文件 (5)

- `jlc_eda_schematic_eco` — 传 `sourcePath`、对应的 `sourceCheckpointPath`、新目录和请求 ID。从 `derive` 开始。`mode` 可选 `passives`（阻容）、`add_page`（增页）、`notes`、`single_point` 或 `unrouted_decoupling`，各模式按自己的阶段执行。
- `jlc_eda_incremental_pcb` — 在完成的 PCB 上修改有来源的局部走线、过孔、位号或钢网。传来源和新目录，`derive` 后以 `changes` 执行 `plan → apply → verify → finish`。
- `jlc_eda_repair_pcb` — 有已核实的部分布线检查点时，提供 `net`、`from`、`to`、`paths` 和 `purpose`，按需加 `vias`。先 `plan` 检查障碍和规则，再 `apply`、`verify`。
- `jlc_eda_export_pcb_dsn` — 传已绑定的工作 PCB 和 `requestId`，导出供外部布线器使用的 DSN。保留文件路径、SHA-256 和该请求 ID。
- `jlc_eda_import_pcb_ses` — 将同一 DSN 对应的 `exportRequestId`、`sesPath` 和 `sesSha256` 传回，`preservationPolicy` 设为 `strict_collinear_coverage`。按 `plan → apply → verify` 导入并复核。

### 收尾与制造交付 (3)

- `jlc_eda_finish_work_project` — 传工作副本、同一 `circuit` 及收尾 `requestId`。核对保存、独立磁盘读取和自有窗口关闭，检查 `persistenceVerified` 及返回的工作文件路径。
- `jlc_eda_stop_work_project` — 在受支持的路由超时、界面回滚或部分文件路由状态下，传原 `routeRequestId`、收尾请求和对应 `mode` 以保存现场。`operationSucceeded` 与 `designReady` 单独报告。
- `jlc_eda_export_manufacturing` — 传已保存成品的 `sourcePath`、新 `outputDirectory` 和 `requestId`。`generate` 产出 Gerber、BOM、贴片坐标和报告，`verify` 复核已捕获的文件，`refresh_previews` 更新预览。

### 规模与适用范围

多页合并校验每板最多 **12 页、500 个器件、256 个命名网络**。指定局部布线每批最多 **32 条连接**。增页时，新增贴片件及采用圆形镀通孔的器件可放到底面。独立阻容修改每阶段支持 1–2 个方向和几何兼容的常规两脚电阻或无极性 MLCC。[多页与布线用法](skills/jlc-eda-project/references/usage.md) · [阻容修改](skills/jlc-eda-project/references/passives.md)

<details>
<summary><strong>原生窗口、后台副本与中断恢复</strong></summary>

工作副本默认在后台打开。需要原生选料器或导入复核时，新建副本可指定 `renderMode: "visible"`。

- `needs_ui` 指明需要操作的窗口。完成原生步骤后，用同一请求核验。
- `pending` 或 `unknown` 表示写入结果待确认。保留副本、回执和 journal，先只读诊断。
- `ok` 对应当步操作，`closed` 表示工作副本已完成保存、独立回读及关闭。整板是否布通要看铜连接和严格 DRC 结果。

</details>

## 验证与兼容性

- **软件回归**　A31-r4 在干净安装下通过 **250/250 项离线测试**。编译后的 MCP 匹配 35 项工具定义，并拒绝全部 35 个非法输入。[测试说明](docs/testing.md) · [GitHub Actions](https://github.com/aning0922/codex-jlc-eda/actions/workflows/ci.yml)
- **桌面环境**　4.1.60 是早期基线。4.1.71 有完整 RC 流程记录，4.1.105 有多页四层板和跨宿主回读记录。其他平台、编辑器版本及 `.eprj3` 工程需单独验证。高速、射频、高压、多板设计和任意整板自动布线也超出当前实测范围。[版本与验收范围](docs/development-status.md)
- **依赖状态**　2026-11-20 的 `npm audit` 对锁文件报告 3 项高危、5 项中危。进入运行包的相关依赖及审计结果见[依赖安全核查](docs/dependency-security.md)。

## 文档与支持

[日常操作手册](skills/jlc-eda-project/references/usage.md) · [RC 示例](examples/rc-filter/README.md) · [变更记录](CHANGELOG.md) · [路线图](docs/roadmap.md) · [贡献指南](CONTRIBUTING.md)

工程副本和制造文件在本地处理。库搜索、账户与同步可能使用嘉立创服务，返回给 AI 宿主的内容可能含工程路径、模型和预览。插件无需单独的大模型 API Key。项目代码、文档与原创插图采用 MIT 许可，打包依赖保留各自许可，真实库模型和原生工程由使用者在本地读取。[来源与分发](docs/sources-and-licenses.md) · [第三方许可](THIRD_PARTY_NOTICES.txt)

提交反馈时请附上插件与 EDA 版本、平台、返回状态及脱敏复现步骤。安全问题请使用私密报告渠道。[GitHub Issues](https://github.com/aning0922/codex-jlc-eda/issues) · [安全报告](SECURITY.md)
