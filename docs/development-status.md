# Development status / 开发进展

2026-11-20 · Local source / 本地源码 `0.11.0-dev.a22`. The latest published runtime is [Alpha.3](https://github.com/aning0922/codex-jlc-eda/releases/tag/v0.11.0-alpha.3).

The RC qualification used EDA 4.1.71 for A6–A9 and 4.1.105 on macOS for the A10 closeout and A11 background lifecycle. Project files and native evidence are retained locally.

## Version map / 版本对应

| Version | Meaning / 含义 |
|---|---|
| `0.11.0-alpha.3` | Published developer preview; 105 offline tests at release. Does not include A6–A10 changes. / 已发布预览，不包含后续成果。 |
| `0.11.0-alpha.4` | Historical local A6 candidate, never published. Its release notes describe that snapshot only. / 历史本地候选，仅代表 A6 时点。 |
| `0.11.0-dev.a7` / `dev.a8` | Independent schematic/sync and placement/routing qualification builds. / 原理图同步与布局布线开发验证。 |
| `0.11.0-dev.a9-r1` | Most recent completed RC replacement workflow, within the scope below. / 最近完成限定验收的 RC 换料流程。 |
| `0.11.0-dev.a11` | Background working copies and board-scoped inspection. / 隐藏工作副本、跨宿主恢复和按板读取。 |

A12 adds explicit deferred pins and native wire junctions for a partially drawn schematic. / A12 可记录阶段内留空的真实引脚，并按实际引脚位置绘制有分支的导线。

A13 verifies the native default unnamed net retained by EDA 4.1.105 on first import with open pads. / A13 可核实含待接引脚的首次 PCB 同步，空网记录须对应实际留空的焊盘。

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

## A10 and A11 on macOS 4.1.105

A10 retained two corrected texts and all three specified positions in the drawing frame after reopening. The comparison covered the full PCB archive. A11 edited a new RC copy, recovered the same headless session through a second Codex app-server process, saved, reopened independently and closed both owned sessions. The native picker remains available on explicitly visible copies.

A10 两处文案和三条位置已完成磁盘回读。A11 在隔离的 Codex 宿主安装候选运行包，使用公开 MCP 入口对接真实 EDA。工程副本默认隐藏，复核选料时应在新副本创建请求中选用可见模式。

## Remaining qualification / 仍需验证

1. Resolve window focus and connection recovery, then finish the existing notes-editing workflow with complete preservation and fresh disk readback.
2. Qualify a selected final build in the actual chat host. Independent MCP processes, protocol simulation and installed-file matching are different evidence layers.
3. Verify assembly orientation, 3D/mechanical fit and physical performance before any production conclusion. Native DRC 0 and generated files alone are insufficient.
4. Qualify other platforms, editor versions, complex footprints and `.eprj3` separately.

先解决窗口/连接体验，再闭合说明更正与交付一致性；随后补齐实际宿主验收。制造、机械、装配及实物资格独立判断。本次 GitHub 同步没有发布新的预编译版本。
