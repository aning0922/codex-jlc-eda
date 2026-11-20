# Roadmap / 路线

2026-11-20 · Qualification sequence / 后续验收顺序。

| State / 状态 | Work / 工作 |
|---|---|
| **Completed within scope / 限定完成** | 4.1.71 model source reading; RC schematic and initial sync; constrained placement and native routing; compatible C1 replacement, preservation and fresh disk verification. / A6–A9-R1 已取得限定实机结果。 |
| **Current source / 当前源码** | A31-r4 supports multi-sheet continuation, placement on either side and routing against filled copper planes. The 12-sheet board still has 348 remaining connections. / 多页增量、双面放件和覆铜后的局部布线已核验，12 页案例仍有 348 处待连。[Validation / 验证记录](validation.md) |
| **Next / 下一步** | Review the board-level differences before authorizing a hardware design change. / 先确认支路差异，再确定下一次电路修改范围。 |
| **Before a new runtime release / 新运行包前** | Select a candidate, qualify actual chat-host loading, complete the RC user journey, and verify packages and installation. / 实际宿主、完整使用体验及安装包验收。 |
| **Later / 后续评估** | Broader connector changes, footprints and platforms, with explicit source, preservation and recovery evidence. / 依据证据扩展器件、封装和平台。 |

See [development status](development-status.md) for the distinction between completed real-editor workflows and unfinished source. No promise of arbitrary whole-board optimization, production readiness or physical performance.
