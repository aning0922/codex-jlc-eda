# Dependency security review / 依赖安全核查

**2026-10-10 · 0.11.0-alpha.3 · targeted dependency fixes / 最小依赖修复。**

Alpha.1/Alpha.2的已知问题保留为历史；这些旧运行包没有被修改或宣称已修复。Alpha.3将`fflate`精确固定到**0.8.3**，将`@modelcontextprotocol/sdk`从1.30.0限定更新到**1.31.0**。除根版本元数据及这两个包的version/resolved/integrity外，锁文件依赖记录保持；没有升级2.x或执行audit fix。

| Package / 包 | Earlier / 旧版 | Alpha.3 | Finding and result / 结论 |
|---|---|---|---|
| fflate | 0.8.2 | 0.8.3 | [GHSA-px8p-9vwx-vf98](https://github.com/advisories/GHSA-px8p-9vwx-vf98) affects synchronous ZIP64 parsing used by this runtime. The synthetic missing-extra-field case hangs in the old version until its parent kills it at 1500 ms; the new version rejects it with error code 13. Valid ZIP64 still completes. |
| MCP SDK | 1.30.0 | 1.31.0 | [GHSA-6qxp-vccf-f47h](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-6qxp-vccf-f47h) concerns HTTP OAuth clients, not the project's current stdio paths. The bounded 1.x update nevertheless moves the lockfile to the upstream patched version. |

See the [upstream fflate fix release](https://github.com/101arrowz/fflate/releases/tag/v0.8.3). The old timeout and new explicit rejection are measured in isolated child processes; no potentially hanging input is parsed in the main test runner. The public regression covers malformed and valid ZIP64 cases with a 1500 ms wall-clock limit and SIGKILL on timeout.

正常兼容性另用两份已有只读原生/制造归档检查：旧/新解包的全部文件名、字节数与内容SHA一致，原ZIP保持。它证明这些具体档案的兼容性，不扩大为所有ZIP变体均受覆盖；真实档案不随公共源码分发。

## Audit / 审计

完整`npm audit --json`包含devDependencies：这些声明中的包可能实际打进runtime，不能使用`--omit=dev`隐藏它们。Alpha.3最终完整审计在2026-10-10返回0项已知漏洞，105项离线/35工具协议结果见[验证记录](validation.md)。审计是某时点已知公告匹配，不是渗透测试或“所有漏洞已消失”的保证。

The plugin remains a local stdio MCP, not a sandbox for hostile archives. Prefer inputs with known provenance, preserve unknown-operation evidence, and report new issues privately. Alpha.3 has not been installed into the actual chat host and the RC example has not run; these dependency checks do not establish real-editor or hardware qualification.
