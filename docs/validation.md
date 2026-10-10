# Validation record / 验证记录

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
