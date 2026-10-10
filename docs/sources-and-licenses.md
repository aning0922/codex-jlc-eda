# 来源与分发边界

本地候选 0.11.0-alpha.3，整理日期 2026-10-10。公开发布仍待维护者验收。

| 内容 | 来源与处理 |
|---|---|
| `src/*.mjs`、Skill、原有测试代码 | 从既有 0.10.0-p4-e 项目实现按白名单抽取；自有实现采用根目录 MIT 许可。几何两处 import、版本和发布工程配置为本轮改动。 |
| `src/board-geometry.ts` | 从原项目的同名 TypeScript 几何模块逐字提取，无外部 import。构建用 esbuild 去除类型，生成被忽略的同目录 `.mjs`；算法保持。对应 13 项原数学测试一起保留。 |
| `tests/fixtures/public-tools.json` | 从冻结 0.10.0-p4-e 编译公共 MCP 的 tools/list 抽取，本项目的 35 工具描述及 JSON Schema。没有工程、模型、账户或会话记录。 |
| 其他离线 fixture | 测试代码内手写的短 JSON、数学坐标、字符串和原生格式片段；是解析/拒绝行为的合成输入，不是实际保存证据。新增几何用例由本项目编写。 |
| 本轮构建脚本、文档与 RC 需求 | 本项目编写，MIT。RC 仅为需求、连接表和复现规格，尚无可分发原生板图或硬件成品。 |
| 打包 npm 运行依赖 | 从锁文件固定解析，构建逐项收集实际打入 bundle 的许可证全文；见 `THIRD_PARTY_NOTICES.txt`。构建遇到缺失声明或正文即失败。各依赖保留原许可，不改授 MIT。 |
| 构建工具及未打入包的依赖 | 见 `package-lock.json` 中来源/完整性/许可；安装后各包 LICENSE 保留在 node_modules，运行包不携带这些工具。 |

来源项目的 `THIRD_PARTY.md` 和组合设计记录说明社区实现仅作设计参考，没有将社区算法源码直接拼接入核心。本轮核对了抽取模块的 import、构建输入、源码出处注记及该记录，没有发现这些参考项目的模块或复制声明；这不是对所有历史作者活动的独立版权证明。公开前由发布方确认自有代码处分权和署名。当前 `Codex JLC EDA contributors` 是项目贡献者集合署名，未冒称第三方或 OpenAI 官方维护。

参考项目（来源记录中的用途，不是本包依赖）：

- [easyeda-agent](https://github.com/zhoushoujianwork/easyeda-agent)：引脚/焊盘分开建模、同步后原生复核思路；原记录说明未复制算法源码。同步调研固定提交为 `217020d59fd3f2d1e43aa91307d220c628f655ee`。
- [easyeda-mcp-pro](https://github.com/oaslananka/easyeda-mcp-pro)：修改预览与回读思路。
- [jlcmcp](https://github.com/hyl64/jlcmcp)、[JLCEDA-MCP](https://github.com/sengbin/JLCEDA-MCP)：官方协议接入方式调研。
- [easyeda-api-skill](https://github.com/easyeda/easyeda-api-skill)：旧工作台曾使用的外部桥接运行时，固定提交 `8895d98637dab59ed9de10bb2a340e3e4be26d99` 的许可未核实；**本候选不包含也不依赖其脚本**。
- [eext-run-api-gateway](https://github.com/easyeda/eext-run-api-gateway)：旧工作台外部扩展，本候选不包含 `.eext` 或 vendor。

嘉立创专业版、官方 CLI、账户服务、真实器件库、符号/封装/3D 和数据表不是本项目的软件资产。用户在自己的安装和账户内现场读取；本仓库不授予这些内容的再分发权。历史 `passive-real.json`、原生 ZIP/eprj2、journal、截图、制造文件和真实模型集合因再分发资格未确认全部排除。受控 fixture 测试需要有权限的本地副本，不可把它们提交到公共仓库。

这也意味着 Alpha 首轮没有“已公开可复现的完整硬件样板”资格。后续由助手使用可用原生界面创建全新空白模板开始，实际料号现场复核；是否公开其模型/原生文件需另行核实。源码开源与硬件文件许可分别处理。[GitHub 许可证说明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)。

本版 `docs/assets/workflow.svg` 为项目原创概念流程图（MIT），不是实机PCB截图，也不包含商标或第三方素材。新增中英文README、贡献/安全/发布文档同为自有文字；历史安装记录只作历史说明。
