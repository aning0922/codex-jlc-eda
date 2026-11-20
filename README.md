<div align="center">

# Codex JLC EDA

### 从一句需求，到可核验的原理图与 PCB

面向嘉立创 EDA 专业版的本地 MCP / Skill 插件。<br>
真实器件模型 · 隔离工程副本 · 原生布局布线 · 完整保存回读

**简体中文** · [English](README.en.md)

[最新成果](#最新成果) · [快速开始](#快速开始) · [RC 示例](examples/rc-filter/README.md) · [验证记录](docs/validation.md) · [变更记录](CHANGELOG.md)

</div>

![Codex JLC EDA：从需求、真实模型、隔离设计到核验保存的原创概念图，非实机截图](docs/assets/workflow.svg)

| 开发源码 | 公开运行包 | 公共接口 | 许可 |
|:---:|:---:|:---:|:---:|
| `0.11.0-dev.a31-r4` | [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | **35 项 MCP 工具** | [MIT](LICENSE) |

截至 2026-11-20，开发版可在已有走线的低压单板上继续设计。你可以在工作副本中增添原理图页、接入旧页预留引脚、在板的正反面放置新器件，并分批布线。插件会从磁盘重开工程，检查网表、已有铜线和剩余待连数。

## 最新成果

### STM32H563 四层控制板 · 局部布线

在 EDA Pro 4.1.105 中保存并重开了 **12 页、265 个器件、161 个网络**的工程。本阶段接通了 37 个目标信号网上的 74 处断点。按四层 Gerber 和数控钻孔文件独立重建铜连接后，161 个网的导通分组均与编辑器回读一致。

全板待连数从 **487 降到 348**。严格 DRC 另报 **480 个未连标记**，短路和间距违规均为 0。新启动的 Codex 宿主加载了 A31-r4，并以只读方式重开了这份工程。[验证记录](docs/validation.md)

### RC 双层滤波板 · 完整布线与换料

在 EDA Pro 4.1.71 中从空白工程完成了 8 个器件、13 个引脚的小板。3 个网全部布通，共 21 段线、0 过孔，严格 DRC 为 0。C1 从 **10 nF 换为 100 nF** 后，原有走线经保存重开核对。41 个制造文件通过检查，装配方向、3D 配合和样板性能仍待验证。[RC 示例](examples/rc-filter/README.md) · [开发进展](docs/development-status.md)

## 能做什么

你描述电路目标与工程位置，助手通过工具逐步读取、规划、执行和核验。

| 工作环节 | 当前能力 |
|---|---|
| **读懂工程** | 工程身份、真实库模型、完整原生记录、原理图引脚、PCB 焊盘与铜连接 |
| **绘图与同步** | 从空白模板绘图并首次同步 PCB，也可在已布线副本上逐页扩展，将旧页预留引脚接入新页 |
| **布局与改件** | 双层或四层板的板框、安装孔和器件定位。增页时可把新贴片件或采用圆形镀通孔的器件放到底面。另支持常规两脚阻容新增、兼容换料及局部改接 |
| **布线与覆铜** | 受限官方路由，或每批最多 32 条指定连接。支持顶底层分段变宽、普通过孔和内外层实心覆铜，重铺后核验孔环接触与热焊盘辐条 |
| **保留设计** | 前后完整档案比较、非目标内容保持、未知写入不重放、按原请求恢复或诊断 |
| **保存交付** | 两端保存、全新磁盘上下文读回、本地 Gerber / BOM / CPL 与预览、文件摘要清单 |

多页合并校验的输入上限为每块板 **12 页、500 个器件、256 个命名网络**。独立的阻容修改流程每阶段限 1–2 个常规两脚电阻或无极性 MLCC，并要求方向和封装几何兼容。高速、射频、高压、多板和任意整板自动布线仍待独立验证。[多页设计与局部布线用法](skills/jlc-eda-project/references/usage.md)

## 快速开始

### 1 · 选择版本

| 你的目的 | 使用入口 | 需要了解 |
|---|---|---|
| 使用或开发多页、四层板流程 | 当前仓库源码 `0.11.0-dev.a31-r4` | 按下方命令构建并安装 runtime ZIP |
| 使用现有预编译包 | [Alpha.3 预发布](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | 2026-10-10 的社区预览，可直接安装，早于 A6–A31 的开发工作 |

环境要求：**macOS、Node.js ≥20、嘉立创 EDA 桌面专业版、支持本地 stdio MCP 的 Codex 宿主**。4.1.60 是早期基线，4.1.71 与 4.1.105 已完成上述限定路径验证；其他平台、版本及 `.eprj3` 路径另验。原生交互需要宿主桌面能力或操作者配合。[官方 CLI 文档](https://prodocs.lceda.cn/cn/api/guide/cli.html)

### 2 · 从最新源码构建

```sh
git clone https://github.com/aning0922/codex-jlc-eda.git
cd codex-jlc-eda
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-dev.a31-r4") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
```

产物位于 `release/0.11.0-dev.a31-r4/`，包含 source / runtime ZIP、逐文件清单及 `SHA256SUMS`。解压其中的 runtime ZIP 后，按第 3 步安装。

<details>
<summary><strong>使用公开 Alpha.3 运行包</strong></summary>

下载 [runtime ZIP](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/codex-jlc-eda-0.11.0-alpha.3-runtime.zip) 和 [SHA256SUMS](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/SHA256SUMS)，将下列摘要与清单对应条目比较，再解包到固定目录。

```sh
shasum -a 256 codex-jlc-eda-0.11.0-alpha.3-runtime.zip
```

保留根 `.agents/` 与 `plugins/jlc-eda/`；运行包自带 bundle，无需 `npm install`。已发布版本采用 `fflate 0.8.3` 与 MCP SDK `1.31.0`，历史依赖修复见[安全核查](docs/dependency-security.md)。

</details>

### 3 · 安装解包后的本地运行包

以下命令适用于上述任一 runtime ZIP 的解包根目录；安装前确认选定版本。

```sh
codex plugin marketplace add "/absolute/path/to/unpacked-runtime"
codex plugin add jlc-eda@jlc-eda-alpha --json
codex plugin list --marketplace jlc-eda-alpha --json
```

已有同名插件时，停用旧来源并保留缓存，避免两个 `jlc_eda` 服务混淆。需要重载时，在方便中断其他工作时完整重启桌面宿主，然后从新上下文核对实际加载版本。[本地插件安装说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

安装文件匹配与实际宿主加载分别验收。源码仓库不含 `dist`；不能将 Git 仓库来源视为已验证的零构建安装入口。启动器优先使用 `CODEX_MCP_NODE_PATH`，否则使用 PATH 中的 `node`；EDA 安装路径特殊时可指定 `JLCEDA_CLI_PATH`。

### 4 · 开始对话

> 使用嘉立创 EDA 助手检查环境，报告实际加载的插件版本、工具数和编辑器连接状态；现在只检查环境。

应报告你安装的版本和 **35** 项工具。若 `editorConnected=false`，先打开 EDA 桌面编辑器。使用开发版时，可以这样描述任务。

> 从全新空白模板建立低压 RC 滤波小板，核对真实器件与全部引脚，完成原理图、PCB、连接检查及保存回读。

> 从已保存的四层板派生副本，在新图页接入上一页预留的 MCU 引脚。保留已有走线，保存重开后报告网表变化和剩余待连数。

## 验证与恢复

A31-r4 干净安装后通过 **250/250 项离线回归**。编译后的 MCP 通过 35 项工具的协议比对，并拒绝了全部 35 个非法输入。[验证记录](docs/validation.md)

2026-11-20 的完整 `npm audit` 在锁定依赖中报告 **3 项高危、5 项中危**，其中 MCP SDK、Zod 和 fast-uri 进入了运行包。[依赖安全核查](docs/dependency-security.md)

| 返回状态 | 应如何继续 |
|---|---|
| `needs_ui` | 在工具指出的准确窗口完成原生步骤，再用同请求验证 |
| `unknown` / `pending` | 保留工程、回执与 journal，先只读诊断，避免重复执行 |
| `failed` / `unsupported` | 依据具体模型、来源、几何或状态缺口处理 |
| `ok` / `closed` | 查看该阶段的证据范围；最终持久化要求独立磁盘回读 |

[日常使用](skills/jlc-eda-project/references/usage.md) · [阻容修改](skills/jlc-eda-project/references/passives.md) · [测试说明](docs/testing.md) · [后续路线](docs/roadmap.md)

## 数据与许可

工程、副本和制造文件由本地 MCP 处理；库搜索、账户与同步可能使用嘉立创官方服务。工具结果会交给 AI 宿主，可能包含工程路径、模型和预览，按宿主设置处理。本插件不要求额外的大模型 API Key。

自有代码、文档和原创概念图采用 [MIT](LICENSE)，打包依赖保留[各自许可](THIRD_PARTY_NOTICES.txt)。真实库模型、原生工程、实机截图和制造资料保持本地；公开回归使用合成测试数据。[来源与分发边界](docs/sources-and-licenses.md)

## 参与项目

[贡献指南](CONTRIBUTING.md) · [提交反馈](https://github.com/aning0922/codex-jlc-eda/issues) · [安全报告](SECURITY.md) · [发布记录](https://github.com/aning0922/codex-jlc-eda/releases)

反馈请包含版本、平台、状态码与脱敏最小复现。安全问题通过[私密报告入口](https://github.com/aning0922/codex-jlc-eda/security/advisories/new)提交。
