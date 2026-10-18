# Validation record / 验证记录

## Current source — 0.11.0-dev.a10 / 当前源码

2026-10-18 source sync. The checks below apply to the current source, including a synthetic public replacement for the private footprint fixture. / 本次核查对象为当前源码与合成公开 fixture。

| Layer / 层次 | Result / 结果 |
|---|---|
| Offline regression / 离线回归 | **188/188**, with no failures, skips, cancellations or todos. No real EDA calls. |
| Compiled MCP / 编译协议 | **35 tools**, current schemas/descriptions/annotations, 35 invalid-input rejections and simulated doctor; not actual chat-host qualification. |
| Packaging / 打包 | Complete source allowlist, isolated source build/tests, runtime manifest/hash validation and relocated launch checked. No private model capture in either package. |
| Documentation / 文档 | Chinese/English shell-command parity, local Markdown links and source allowlist scan checked. |
| Real-editor history / 实机历史 | A6–A9-R1 have bounded results on macOS / EDA 4.1.71 using independent development builds. See [the evidence summary](development-status.md). No new editor run in this sync. |
| Open work / 未闭合 | A10 text positions, final saved delivery, actual chat-host loading and stable background interaction remain unqualified. |
| Hardware / 硬件 | RC manufacturing files validated; assembly/3D review and physical performance remain open. |
| Remote CI / 远端 | Inspect [Actions](https://github.com/aning0922/codex-jlc-eda/actions) for the exact commit and Node 20/24 results; local checks alone do not establish remote success. |

Current tool count remains 35, while some schemas and descriptions have changed since Alpha.3. Public synthetic fixtures verify the software contract; locally retained real-model cases are not redistributed. The next section preserves the older release's evidence separately.

## Historical release — Alpha.3 / 历史发布记录

2026-10-10 · developer preview `0.11.0-alpha.3` · local software checks / 本地软件验证。

| Layer / 层次 | Status / 状态 |
|---|---|
| Inherited real-editor behavior / 继承实机行为 | Existing 0.10.0 records cover bounded workflows, not arbitrary designs or Alpha.3 qualification. |
| Alpha.1 / Alpha.2 historical evidence | 103 offline tests and 35 compiled tool schemas were checked. Alpha.1 had 19 installed files matched; the last observed chat service was still 0.10.0. Old packages remain unchanged and unpatched. |
| Alpha.3 clean install and offline / 干净安装与离线 | Node 24.21.0, exact locked dependencies, **105/105 passed**, 0 failures/skips/cancellations/todos. Includes the existing 103 plus two ZIP64 regressions. |
| ZIP64 regression / 挂起回归 | Same synthetic malformed input: 0.8.2 timed out and was killed at 1500 ms; 0.8.3 rejected it with code 13 in about 34 ms. Valid ZIP64 completed in both. The public tests always isolate parsing in a timed child process. |
| Normal native/manufacturing archives / 正常档案 | Read-only native-before.zip (4 entries) and fabrication.zip (14 entries): old/new entry names, lengths and SHA-256 hashes match; originals unchanged. No real model data is distributed. |
| Public MCP / 编译协议 | Source and isolated runtime report Alpha.3 and 35 tools; full schemas/descriptions/annotations match the frozen baseline. Invalid inputs are rejected before CLI calls. Doctor is simulated, not a real host check. |
| Complete dependency audit / 完整审计 | `npm audit --json`, including devDependencies: **0 known vulnerabilities reported** on this date. No `audit fix` or omit=dev. This does not guarantee all vulnerabilities are absent. |
| README and assets / 文档与包 | Bilingual command parity, local links, versioned manifests, runtime portability and source allowlist checked. Local previews are not remote GitHub rendering. |
| Actual host / RC / 实机 | Alpha.3 not installed; no RC project, native DRC/save cycle, manufacturing run or physical test in this release round. The eight-component RC example is still a specification. |
| GitHub / 远端 | This page records local validation. See [Actions](https://github.com/aning0922/codex-jlc-eda/actions) for remote workflow status; local results do not establish remote success. |

## Interpreting the evidence / 资格边界

The tool baseline includes all 35 names, descriptions, annotations and schemas. Dependencies and version labels changed, not the board-design algorithms. The SDK remains within 1.x and the transport remains stdio; no HTTP OAuth capability was introduced.

模拟doctor、独立CLI、编译子进程或安装文件匹配，均不能证明实际聊天宿主已加载该版。离线测试与受控归档比较不能替代真实模型、完整逻辑/铜/严格DRC、原生视觉以及保存后的独立磁盘回读。

The banner is an original conceptual diagram, not a real PCB screenshot. No certification of electrical safety, physical performance or manufacturability is implied. Real archive fixtures remain private pending redistribution rights; public fixtures are synthetic.
