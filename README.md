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
| `0.11.0-dev.a10` | [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | **35 项 MCP 工具** | [MIT](LICENSE) |

> **当前进展 · 2026-10-18 同步**
> RC 小板已在 EDA Pro 4.1.71 的独立开发构建中完成原理图、PCB 同步、约束布局、官方布线、兼容换料和保存回读。最新源码包含这些成果及尚未完成验收的 A10 说明编辑分支；公开下载仍为 Alpha.3，不包含后续开发能力。项目为社区 Alpha 开发预览，非嘉立创或 OpenAI 官方项目。

## 最新成果

从真实空白工程出发，先完成一块 RC 信号滤波小板，再从保存闭合的成品派生副本，将 C1 从 **10 nF 换为 100 nF**。以下结果来自 2026-10-10 至 10-11 的限定实机验证。

| 8 器件 · 13 引脚 · 3 网络 | 21 段线 · 0 过孔 | 严格 DRC 0 | 41 个制造文件 |
|:---:|:---:|:---:|:---:|
| 全部 pin → net → pad 核对 | 三网全铜连通，约 60.24 mm 总线长 | 与连通、视觉、保存分别检查 | Gerber / BOM / CPL 等文件核对 |

- **A6 · 真实模型读取** — 直接读取并核验符号 / 封装源码，保留身份、单位和几何来源；完成 4.1.71 既有板限定编辑与保存验证。
- **A7 · 原理图到 PCB** — RC 原理图、本地交换文件导入、受控空板首次同步，以及未布线阶段的完整保存闭合。
- **A8 · 布局与官方布线** — 评价官方布局候选、采用电路约束位置，再完成官方路由、严格检查和新磁盘回读。
- **A9-R1 · 真实兼容换料** — C1 换为兼容 100 nF 实际器件，保留非目标内容、网络、布局、规则与既有铜，完成保存关闭及本地制造文件检查。
- **A10 · 说明编辑开发中** — 两处文字内容已有现场档案证明；位置整理、最终保存回读与新交付尚未完成。窗口焦点干扰仍待解决。

制造结果为 `filesValid=true`、`manufacturingReady=false`：装配方向、3D 及实物性能仍需另验。完整范围见[开发进展与证据摘要](docs/development-status.md)。

## 能做什么

你描述电路目标与工程位置，助手通过工具逐步读取、规划、执行和核验。

| 工作环节 | 当前能力 |
|---|---|
| **读懂工程** | 工程身份、真实库模型、完整原生记录、原理图引脚、PCB 焊盘与铜连接 |
| **创建小板** | 原生空白模板、原理图绘制与标注、PCB 初次同步、约束布局与受限官方路由 |
| **修改成品** | 从 closed 成品派生；顶层常规两脚 R/C 新增、兼容真实换料、有创建来源的局部改接 |
| **保留设计** | 前后完整档案比较、非目标内容保持、未知写入不重放、按原请求恢复或诊断 |
| **保存交付** | 两端保存、全新磁盘上下文读回、本地 Gerber / BOM / CPL 与预览、文件摘要清单 |

适用于**单页单板、低压双层小板**。阻容增量限常规两脚电阻 / 无极性 MLCC、正交方向与兼容几何，每阶段 1–2 件。高速 / 射频 / 高压、多板、任意换封装和任意整板自动优化不在当前验证范围。

## 快速开始

### 1 · 选择版本

| 你的目的 | 使用入口 | 需要了解 |
|---|---|---|
| 查看或开发最新成果 | 当前仓库源码 `0.11.0-dev.a10` | 需构建；A10 说明编辑仍未闭合 |
| 使用现有预编译包 | [Alpha.3 预发布](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) | 无需 npm 安装；不包含 A6–A10 的新增能力 |

环境要求：**macOS、Node.js ≥20、嘉立创 EDA 桌面专业版、支持本地 stdio MCP 的 Codex 宿主**。4.1.60 是早期基线，4.1.71 已完成上述限定路径验证；其他平台、版本及 `.eprj3` 路径另验。原生交互需要宿主桌面能力或操作者配合。[官方 CLI 文档](https://prodocs.lceda.cn/cn/api/guide/cli.html)

### 2 · 从最新源码构建

```sh
git clone https://github.com/aning0922/codex-jlc-eda.git
cd codex-jlc-eda
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-dev.a10") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
```

产物位于 `release/0.11.0-dev.a10/`，包含 source / runtime ZIP、逐文件清单及 `SHA256SUMS`。这是本地开发构建，不代表新版本已发布或已通过实际聊天宿主验收。离线测试和协议检查不会调用真实 EDA。

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

应报告你安装的版本和 **35** 项工具。若 `editorConnected=false`，先打开 EDA 桌面编辑器。随后可以提出具体任务：

> 从全新空白模板建立低压 RC 滤波小板，核对真实器件与全部引脚，完成原理图、PCB、连接检查及保存回读。

> 从已完成小板派生副本，将 C1 真实换成兼容封装的 100 nF 电容，保持其他内容，并检查 BOM 与保存结果。

## 验证与恢复

当前源码的公开离线套件为 **188 项测试**，协议检查覆盖 **35 项工具及 35 个非法输入拒绝**。实机成果来自独立开发构建；实际聊天宿主加载、全程后台交互及硬件性能另验。[详细验证记录](docs/validation.md) · [GitHub Actions](https://github.com/aning0922/codex-jlc-eda/actions)

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
