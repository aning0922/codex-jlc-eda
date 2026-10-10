# 变更记录 / Changelog

## 0.11.0-alpha.3 — 2026-10-10

Targeted dependency fix / 最小依赖修复：fflate 0.8.2 → 0.8.3，MCP SDK 1.30.0 → 1.31.0；其他依赖版本保持。新增有1500ms子进程墙钟保护的畸形/合法ZIP64回归；两份既有原生/制造归档的旧/新解包文件名及内容SHA一致。完整离线/协议/audit结果见[验证记录](docs/validation.md)。

准备aning0922/codex-jlc-eda的正式下载、Issues和私密安全报告目标链接，由协调者创建并核实远端后发布。35工具schema、描述、注解和业务算法保持，原Alpha.1/Alpha.2资产保持。本版未安装、无RC实机闭环、无远端CI成功声明。

## 0.11.0-alpha.2 — 2026-10-10

Bilingual documentation and local pre-release preparation / 中英文文档与本地预发布准备。新增完整English README、语言切换和原创概念图、贡献/安全/Issue/PR材料、发布草稿和版本化输出目录。35工具schema/描述/注解及业务算法保持，仅必要版本字面值变化。

本轮待审、未安装、无RC实机闭环、无远端CI或公开发布。完整依赖审计发现fflate 0.8.2运行解包风险及SDK 1.30.0的HTTP OAuth公告；后者不适用于当前stdio路径，前者待针对性修复。依赖保持锁定，详情见[核查](docs/dependency-security.md)。原Alpha.1资产和安装保留。

## 0.11.0-alpha.1 — 2026-10-10

从 0.10.0-p4-e 独立抽取首发候选。纳入自有几何 TypeScript 源码，移除铜连通与局部修复对旧工作台 dist 的两处依赖；算法保持。显式固定构建严格模式，隔离目录外 tsconfig 对 bundle 字节的影响。保留 35 个工具和原 schema。

新增 MIT 候选许可、来源与模型分发边界、中文新用户安装/恢复/隐私说明、离线与私有资料测试分组、编译 MCP 和搬迁检查、CI、明确白名单与可重复 ZIP/清单。运行包只包含两个 bundle 和必要启动/使用/许可资料。新增 8 件低压 RC 小实例规格。

本轮为本地构建与离线验证。Alpha 未安装到实际宿主，未执行新板图实例，未公开发布。真实库模型和历史工程因分发许可未确认而排除。
