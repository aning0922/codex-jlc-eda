# Security / 安全说明

## Current status / 当前状态

`0.11.0-alpha.3` is an Alpha developer preview. It pins fflate 0.8.3 and MCP SDK 1.31.0 to address the previously identified dependency advisories. Earlier Alpha.1/Alpha.2 packages remain unchanged and should not be treated as patched. See the [dependency assessment](docs/dependency-security.md) and [validation record](docs/validation.md). No security maintenance period, bounty or response deadline is promised.

## Private reporting / 私密报告

Repository: [aning0922/codex-jlc-eda](https://github.com/aning0922/codex-jlc-eda).

Please use [Report a vulnerability](https://github.com/aning0922/codex-jlc-eda/security/advisories/new) to submit a private report. 请通过此链接私密报告安全问题。

请勿在普通Issue/PR中公开漏洞细节、利用载荷、令牌、真实工程或完整journal。若因权限等原因无法访问私密入口，只提交不含漏洞细节的联系请求。没有额外的安全邮箱或响应时限承诺。

Include the plugin/Node/editor versions, entry point, expected and observed effects, and a minimal redacted reproduction. Do not attach production designs or secrets, and do not test vulnerabilities against other users' projects or services.

## Trust boundary / 信任边界

The plugin is a local stdio MCP with file access and bounded official-CLI actions, not a sandbox for hostile design archives. Dependency updates do not replace input provenance or all resource limits. Treat project, model and manufacturing archives with care.

工具结果可传给AI宿主，官方库/同步功能可能连接嘉立创服务。Local execution does not guarantee data stays on the machine. Native UI approvals, returned `ok` values and generated Gerbers do not independently prove persistence or manufacturing readiness.

Revoke or rotate exposed credentials; deleting a file does not remove prior exposure. 维护者在首次公开前核对私密安全报告、依赖图、Dependabot告警、秘密扫描/推送保护和材料分发权。[GitHub repository security guidance](https://docs.github.com/en/code-security/getting-started/quickstart-for-securing-your-repository)
