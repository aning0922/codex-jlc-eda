# Codex JLC EDA

**简体中文** · [English](README.en.md)

让 AI 助手通过嘉立创 EDA 专业版，在隔离副本中设计低压小板，并用真实模型、网络检查和磁盘回读核验结果。

![概念流程图：需求、真实模型、隔离设计、核验保存；不是实机 PCB 截图](docs/assets/workflow.svg)

**开发预览 `0.11.0-alpha.3`** · **35 项 MCP 工具** · **macOS / EDA Pro 4.1.60** · [MIT](LICENSE)

[快速开始](#快速开始) · [能做什么](#能做什么) · [验证状态](#验证状态) · [使用与恢复](#使用与恢复) · [参与项目](#参与项目)

> 这是 Alpha 开发预览。已用 `fflate 0.8.3` 修复先前识别的 ZIP64 解压依赖问题，并更新 SDK 至 `1.31.0`，见[安全核查](docs/dependency-security.md)。RC 实例尚未执行，Alpha.3 未安装或实机验证。本项目非嘉立创或 OpenAI 官方项目。

## 能做什么

你给出需求与工程路径，助手负责查询真实器件、核对内部身份和引脚几何、规划布局，再逐阶段检查结果。

| 工作 | 当前支持范围 |
|---|---|
| 读取与核对 | 工程身份、真实库模型、原理图引脚、PCB 焊盘、网络与铜对象 |
| 创建低压小板 | 原生空白模板 → 原理图 → PCB 同步与原生复核 → 布局、规则和受限连接 |
| 修改已完成工程 | 从真实 closed 成品派生；常规两脚 R/C 新增、兼容真实换料、有创建来源的局部改接 |
| 局部 PCB 调整 | 受限孔线、位号和工程内钢网调整，核对非目标内容保持 |
| 保存与交付 | 两端保存、全新磁盘读取和完整比对；本地 Gerber、BOM、CPL、预览及检查清单 |

面向单页单板、低压双层小板。阻容增量限顶层常规两脚电阻/无极性 MLCC、正交方向与兼容几何，每阶段 1–2 件。连接器增量、任意换封装、高速/射频/高压、多板和任意整板自动优化不在本版承诺内。

## 快速开始

### 1 · 准备环境

- macOS 与 **嘉立创 EDA 桌面专业版 4.1.60**；浏览器版不适用。官方 CLI 内置于桌面客户端，其他客户端版本尚未验证。[官方 CLI 文档](https://prodocs.lceda.cn/cn/api/guide/cli.html)
- 能运行本地 stdio MCP 的 Codex 桌面宿主，以及 **Node.js ≥20**。启动器优先使用 `CODEX_MCP_NODE_PATH`，否则使用 PATH 中的 `node`。
- 原生界面操作依赖宿主的桌面能力；本包不附带屏幕/鼠标权限。缺少该能力时，操作者完成准确窗口中的模板创建、模型打开、器件替换或导入确认。

### 2 · 使用预编译运行包

面向使用者的资产是 `codex-jlc-eda-0.11.0-alpha.3-runtime.zip`。[预发布页面](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3) · [运行 ZIP](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/codex-jlc-eda-0.11.0-alpha.3-runtime.zip) · [校验和](https://github.com/aning0922/codex-jlc-eda/releases/download/v0.11.0-alpha.3/SHA256SUMS)。下载资产后：

1. 将运行 ZIP 与 `SHA256SUMS` 放在同一目录，核对摘要：

   ```sh
   shasum -a 256 codex-jlc-eda-0.11.0-alpha.3-runtime.zip
   ```

   输出必须与 `SHA256SUMS` 中对应条目一致。校验和检测字节变化，不替代对发布者的信任。
2. 解包到固定目录，保留根 `.agents/` 和 `plugins/jlc-eda/`。运行包已含 bundle，**无需 npm install**。
3. 注册本地来源并安装（本机 CLI 的安装子命令已核实）：

   ```sh
   codex plugin marketplace add "/absolute/path/to/unpacked-runtime"
   codex plugin add jlc-eda@jlc-eda-alpha --json
   codex plugin list --marketplace jlc-eda-alpha --json
   ```

4. 若已有旧来源，停用旧来源的同名插件、保留其缓存，避免两个 `jlc_eda` 服务混淆。需要重载时，在其他工作方便中断后完整重启桌面宿主，再在新上下文确认版本；安装目录存在不代表已加载。[官方本地插件说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

这是本地运行包安装。源码 Git 仓库不含 `dist`，不能把添加 Git marketplace 当作已验证的零构建安装方式。当前 Alpha.3 **未执行上述实际安装**；已有安装文件核验来自 Alpha.1。

### 3 · 发出第一条请求

> 使用嘉立创 EDA 助手检查环境，报告实际加载的插件版本、工具数和编辑器连接状态；现在只检查环境。

预期目标为 `pluginVersion=0.11.0-alpha.3`、`publicToolCount=35`。`editorConnected=false` 时先打开 EDA 桌面编辑器。安装位置不同时，将 `JLCEDA_CLI_PATH` 设置为官方可执行文件的绝对路径。

在运行包的 `plugins/jlc-eda/` 内也可运行 `node dist/cli.mjs doctor`；这只是独立 CLI 检查，不能证明聊天宿主已加载该版。

<details>
<summary><strong>开发者：从源码构建</strong></summary>

进入包含本项目 `package.json` 的源码根目录后执行。显式指定 prefix，避免 npm 向上查找其他项目。

```sh
PROJECT_ROOT="$(pwd -P)"
node -e 'const p=require("./package.json"); if(p.name!=="codex-jlc-eda" || p.version!=="0.11.0-alpha.3") process.exit(1)'
npm --prefix "$PROJECT_ROOT" ci --ignore-scripts --no-audit --no-fund
npm --prefix "$PROJECT_ROOT" test
npm --prefix "$PROJECT_ROOT" run test:protocol
npm --prefix "$PROJECT_ROOT" run package
```

输出位于 `release/0.11.0-alpha.3/`，包含 source/runtime ZIP、逐文件清单和校验和。协议测试使用模拟 CLI，不打开 EDA。详见[测试说明](docs/testing.md)。

</details>

## 使用与恢复

可以这样表达任务，无需提供 UUID、会话 ID 或逐根走线坐标：

- “读取这份工程的隔离副本，核对全部引脚、焊盘网络和铜连接。”
- “从新空白模板建立低压 RC 滤波小板，选真实料号并完成保存回读。”
- “从已完成小板派生副本，把 C1 真实换成兼容封装的 100 nF 电容，保持其他内容，核对 BOM 和保存。”

[8 件 RC 示例](examples/rc-filter/README.md)目前是**待执行规格**：8 件、13 引脚、3 网络，一次 C1 10 nF →100 nF 真实换料。它不是已跑通教程或实物性能证明。

| 返回状态 | 下一步 |
|---|---|
| `needs_ui` | 在工具指出的准确工作窗口完成原生步骤，然后用同请求验证。导入复核时保持 PCB 前台，不重复导入。 |
| `unknown` / `pending` | 保留回执、工程和 journal，只读诊断；不要换 requestId、手改 journal 或盲目重放。 |
| `failed` / `unsupported` | 按具体代码处理模型、来源或几何缺口；写前可重选兼容候选，写后参数冻结。 |
| `ok` / `closed` | 阶段成功不等于全部完成；持久化须独立磁盘回读，closed 复用只核对历史完成结果。 |

详细规则：[日常使用](skills/jlc-eda-project/references/usage.md) · [阻容修改](skills/jlc-eda-project/references/passives.md)。

## 验证状态

| 对象 | 有什么证据 | 尚未证明 |
|---|---|---|
| 0.10.0 继承能力 | 既有受限板图/阻容修改实机记录 | 任意电路、封装或方向的通用资格 |
| Alpha.1 | 独立构建、103 项离线测试、35 工具 schema/编译协议；19 安装文件匹配 | 聊天宿主 Alpha 加载与 RC 全链路；最后实际服务仍为 0.10.0 |
| Alpha.3 开发预览 | 依赖修复、105 项离线测试、正常归档内容比对及编译协议，见[验证记录](docs/validation.md) | 实际宿主加载、RC 实机闭环与实物性能；远端状态见 [Actions](https://github.com/aning0922/codex-jlc-eda/actions) |

网络对应、全铜连通、严格 DRC、视觉、磁盘持久化分别验收。生成制造文件不等于可投产；装配方向、机器零度、机械/3D 和实物性能仍需确认。上传、下单和支付需要另行明确授权。

## 数据与许可

工程、副本和制造文件由本地 MCP 处理；库搜索、账户和同步可能使用嘉立创官方服务。工具结果会交给 AI 宿主，可能包含路径、位号、网络、模型信息和预览，处理方式取决于宿主设置。**本地 MCP 不代表数据绝不离开本机。** 插件不要求额外的大模型 API Key。

自有代码、文字和原创概念图采用 [MIT](LICENSE)；31 项打包依赖保留[各自许可](THIRD_PARTY_NOTICES.txt)。真实库模型、原生工程、截图和制造资料没有自动继承 MIT，本包不包含这些历史材料。详见[来源与分发边界](docs/sources-and-licenses.md)。

## 参与项目

[贡献指南](CONTRIBUTING.md) · [安全报告](SECURITY.md) · [路线](docs/roadmap.md) · [变更记录](CHANGELOG.md) · [预发布说明](docs/releases/0.11.0-alpha.3.zh-CN.md)

普通反馈请在 [Issues](https://github.com/aning0922/codex-jlc-eda/issues) 使用模板，只提供版本、平台、状态码与脱敏最小复现。不要公开完整工程或 journal。私密漏洞请通过[安全报告入口](https://github.com/aning0922/codex-jlc-eda/security/advisories/new)提交，请勿在普通 Issue 泄露漏洞细节。没有承诺邮箱或响应时限。

---

**简体中文** · [English](README.en.md)
