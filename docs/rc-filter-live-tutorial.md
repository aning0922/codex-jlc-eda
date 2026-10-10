# RC 小板复现：实际安装记录与下一步

2026-10-10，0.11.0-alpha.1。本页是独立于冻结首发 ZIP 的新增记录，不表示已完成板图教程。

## 已验证的安装部分

冻结运行 ZIP 的 SHA-256：`545bf3c1bc977cdd7e2bff6e9b191350d0003617659e86e2525d396780817da8`。完整解包，保留根 `.agents/` 与 `plugins/jlc-eda/`。

本次桌面环境的 Codex CLI 支持并实际执行了：

```sh
codex plugin marketplace add "/absolute/path/to/unpacked-runtime"
codex plugin add jlc-eda@jlc-eda-alpha --json
codex plugin list --marketplace jlc-eda-alpha --json
```

CLI 返回插件版本 0.11.0-alpha.1；安装后的 19 个插件文件与运行包清单逐项相同。旧来源 `jlc-eda-local` 的缓存保留，只把其插件 enabled 改为 false；Alpha 来源 enabled 为 true，避免同名 MCP 混淆。其他插件启用设置不改。

**当前聊天尚未加载 Alpha。** 安装后直接 doctor 仍返回 0.10.0-p4-e、35 工具，因此实例尚未开始；没有用另起编译进程替代真实宿主验收。目前因其他项目运行而延后重载，不要求现在退出桌面宿主。后续先由维护者确定最终候选，再统一安装/重载，在同一聊天核对 doctor 的实际版本。只打开/关闭 EDA 不会完成宿主插件重载。[官方本地安装说明](https://developers.openai.com/plugins/build/plugins#install-a-local-plugin-manually)

## 后续统一安排后复现

使用 [8 件 RC 需求与连接表](../examples/rc-filter/README.md)。助手在原生界面新建单 Board、单页原理图与空 PCB，另存新的 blank.eprj2 并关闭，再通过 create_work_project 核对空白资格。操作者不需要提供 UUID、坐标或脚本。

现场选型、模型完整核对、原理图、首次 PCB 同步原生复核、布局/连接、严格 DRC、视觉和保存回读均须实际执行。初始真实 closed 成品形成后，只从该成品派生，将 C1 从 10 nF 兼容真实换料为 100 nF，然后生成一次最终本地制造交付。

当前尚无模板、器件料号/模型、原理图、PCB、真实 checkpoint 或制造文件；这些步骤及耗时不能标为已验证。界面能力、窗口目标和实际模型在重启后核实；若缺少能力，记录准确人工步骤。

## 可公开材料边界

本页、自有需求与自然语言提示属于项目文档，按候选 MIT 许可。真实库模型、原生工程、截图、BOM/制造文件和完整运行日志均未取得独立分发确认，默认保持本地。工具生成不自动授予这些内容 MIT 再分发权。后续逐项审查来源/许可与脱敏，再决定公开清单。
