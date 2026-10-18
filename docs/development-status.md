# Development status / 开发进展

Updated / 更新：2026-10-18。Current source / 当前源码：`0.11.0-dev.a10`。Published runtime / 公开运行包：[0.11.0-alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3)。

本页汇总维护者保留在本地的 2026-10-10 至 10-11 实机记录与总体复核结论。真实工程、库模型、完整日志、原生截图和制造资料没有随仓库分发；公开源码与合成测试可复核软件行为，不能单独重现私有实机证据。本次同步只做源码、文档与离线构建检查，没有重新执行 EDA 操作。

This page summarizes locally retained editor evidence and review results from October 10–11. Native projects, library models, full logs, editor screenshots and manufacturing files are not distributed. Public code and synthetic tests expose software behavior, but do not independently reproduce the private editor evidence. This sync performs source, documentation and offline build checks, with no new editor operations.

## Version map / 版本对应

| Version | Meaning / 含义 |
|---|---|
| `0.11.0-alpha.3` | Published developer preview; 105 offline tests at release. Does not include A6–A10 changes. / 已发布预览，不包含后续成果。 |
| `0.11.0-alpha.4` | Historical local A6 candidate, never published. Its release notes describe that snapshot only. / 历史本地候选，仅代表 A6 时点。 |
| `0.11.0-dev.a7` / `dev.a8` | Independent schematic/sync and placement/routing qualification builds. / 原理图同步与布局布线开发验证。 |
| `0.11.0-dev.a9-r1` | Most recent completed RC replacement workflow, within the scope below. / 最近完成限定验收的 RC 换料流程。 |
| `0.11.0-dev.a10` | Current source; includes unfinished notes editing and bounded recovery work. / 当前源码，说明编辑尚未完成。 |

Tool count remains **35**. Input schemas and descriptions have evolved for model source, import, initial sync, layout, preview refresh and notes editing; the protocol fixture tracks the current contract, not the original Alpha.3 schema.

工具数量保持 35，但部分 schema 与说明已扩展。不要将“工具数相同”解释为接口逐字段未变，也不要将开发构建成果归入旧 Alpha.3 运行包。

## Completed milestones / 已完成的限定验收

| Stage | Evidence and result / 证据与结果 |
|---|---|
| **A6 — EDA 4.1.71 compatibility** | Validated direct symbol/footprint source reading and a bounded existing-board label edit, complete preservation and fresh disk readback. / 真实模型读取及既有板局部编辑保存。 |
| **A7 — Schematic and initial sync** | Real RC circuit: 8 parts, 13 pins, 3 nets. Local exchange-file import and controlled initial synchronization into a proven-empty PCB; saved and closed as `synchronized_unrouted`. / RC 原理图、导入、空板首次同步及未布线阶段闭合。 |
| **A8 — Placement and routing** | Native placement candidate evaluated, circuit-constrained positions adopted, all 3 nets routed; 21 LINE, 0 VIA, strict DRC 0, full copper connectivity and complete fresh disk comparison. / 约束布局、官方路由与完整保存。 |
| **A9-R1 — Real compatible replacement** | C1 10 nF → 100 nF; normal PCB ECO and exact preservation of non-target records, all 21 traces, layout, rules and connectivity; save, fresh disk readback, close and same-request closed reuse verified. / 真实换料、非目标保持、保存关闭及完成复用。 |

A9-R1 review recomputed approximately **60.23535 mm** total trace length and all three connected nets from final captured records. It reran **161/161** offline tests plus private captured-record positive/negative cases. The final manufacturing capture contained **41 files**; reanalysis of a fresh copy returned `filesValid=true`, `manufacturingReady=false` with assembly-orientation and 3D review outstanding. DRC receipts and independent connectivity calculations were checked separately; the review did not rerun native DRC.

A8 的路由预算实际传入 120000 ms，进程预算为 123000 ms；本例引擎实际约 582 ms，因此只证明预算未被截到 60 秒，不证明超过 60 秒的真实引擎作业已运行。双层板定义不代表本例两面都有路由线。

## Open milestone / 未闭合阶段

**A10 — Notes editing remains incomplete. / 自由说明编辑仍未闭合。**

- Two text content changes were observed in a complete live native archive. Three planned positions had not been reached. / 两处内容更正已进入完整现场档案，三条位置尚未到位。
- The native TEXT API could change an in-memory view without updating the stored archive; a successful save return alone did not prove persistence. The implementation keeps this failure evidence and allows only bounded, source-verified recovery. / 界面返回与保存返回值不能替代档案及磁盘证据。
- Final visual review, fresh disk persistence, finish, closed reuse and new manufacturing delivery were not completed. / 最终视觉、磁盘回读、闭合与新制造交付未完成。
- Work stopped after observed focus interference. Stable background window interaction is unresolved; A11 has not started. / 因焦点干扰停止实机操作，A11 尚未开始。

The A9-R1 saved design still contains outdated free-text notes and imperfect text placement. Electrical part values and manufacturing checks do not establish that these annotations were corrected in a final saved delivery. Do not label A10 a finished tutorial or validated general text-editing feature.

A9-R1 成品的自由说明仍有旧参数/未布线字样和位置问题。器件参数已更新不等于所有图面说明已更新；A10 不能写成完整通过或通用文字编辑资格。

## Remaining qualification / 仍需验证

1. Resolve window focus and connection recovery, then finish the existing notes-editing workflow with complete preservation and fresh disk readback.
2. Qualify a selected final build in the actual chat host. Independent MCP processes, protocol simulation and installed-file matching are different evidence layers.
3. Verify assembly orientation, 3D/mechanical fit and physical performance before any production conclusion. Native DRC 0 and generated files alone are insufficient.
4. Qualify other platforms, editor versions, complex footprints and `.eprj3` separately.

先解决窗口/连接体验，再闭合说明更正与交付一致性；随后补齐实际宿主验收。制造、机械、装配及实物资格独立判断。本次 GitHub 同步没有发布新的预编译版本。
