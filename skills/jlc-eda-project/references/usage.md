# 日常使用与状态处理

用户可以直接说：“在这份工程副本上增加100kΩ电阻和10nF电容接3.3V/GND”、“把R4改成47kΩ的兼容0603料号，保持位置和连接”、“将R4第2脚从GND改接DRDY_N，移除它原来的局部地线，保留其他内容”。助手先读工程与真实库、形成影响清单，按公共流程实施并解释实际验收。用户不必提供内部ID、精确坐标或脚本。

## 检查和来源

doctor分别报告官方CLI、客户端版本、编辑器连接和能力。needs_ui只表示当前编辑器状态，closed文件复用无需新启动。open_project使用新读取副本，inspect_project返回当前工程/Board/图页；read_document给实例/脚/几何，read_connectivity给逻辑和pin→pad比较，read_pcb_routing给真实铜与规则。

模型读取不等于器件电气适用，型号数据表链接存在不等于内容已核对，价格/库存不能由EDA旧元数据推断。来源已有工作应由相应derive/resume入口建立正式新副本，不能将只读检查升级成可写。

## 新工程到交付

create_work_project需要原生空模板；已有明确原理图用derive_work_project。助手组织完整器件、所有引脚连接/NC和notes，draw_schematic先place读真实脚，再complete连线；verify_schematic与原生preview通过后保存/新磁盘核对。首次sync_pcb只用于明确关联的空或未布线板：apply → 目标PCB原生复核 → verify。API true与飞线均不是布通。

layout_pcb plan/apply/verify固定真实位置/板框，configure_pcb_rules只改任务当前规则并保留检查项/全局预设；新check_pcb的boardReady需要逻辑、布局、全部铜连通和新严格DRC。受限局部repair_pcb/incremental_pcb有完整来源与范围门禁；自动/文件路由的资格只按对应验收版本与上下文处理，未知引擎不重跑。当前单个工程成功不等于一般自动布通率。

save_work_project只请求保存；finish_work_project承担完整新磁盘/现场稳定/关闭证明。读取上下文用close_session回收，已销毁上下文不重复关闭。来源归属不明或用户窗口不清时保留。

## 已完成板修改

incremental_pcb支持普通孔移动/尺寸、同网线端更新、短线增删替换、普通孔线新增、可见位号，以及受限EP首组钢网分窗。plan之后源和参数冻结，未知不重放。工程独立钢网用prepare_model → 精确原生“仅选中实例”复制 → adopt_model → apply；共享/全局封装不写。导出完整原生档案不能用可能遗漏微线的API文档替代。

schematic_eco默认single_point为已验收测试点流程；两脚R/C新增、兼容换料与有创建来源的改接使用passives模式，读取passives.md。任意器件删除、更换不同几何封装、底层镜像、多页ECO及复杂用户支路自动重构尚未支持。

## 制造与常见停点

export_manufacturing从最终成品自动发现单板，生成本地Gerber/BOM/CPL、预览、报告和SHA清单。assembly=reflow/hand、viaTreatment按用户实际工艺；未指定孔处理保留unspecified。导出unknown时仅verify完整捕获文件，不重发原生导出、不换请求绕过。deliveryGenerated与manufacturingReady分开。

- 复核未应用：保持目标PCB，只查看明确清单并应用一次，然后同请求verify。
- 原生替换未核验：保持准确原理图/目标，不再次替换；检查实际料号、保留身份/符号/封装设置及完整差异。
- 来源/参数冲突：检查是否用了正确成品/checkpoint/同请求原参数；新修改应从已闭合成果正式派生，不能手改旧记录。
- unknown写入/导出：保留现场和回执，读取当前实际结果；没有对应受限恢复证据就不重放。
- 保存或新磁盘不匹配：保留工作窗口，准确原生保存后再验证；不能把save true当完成。
- 几何/网络/非目标/DRC失败：报告实际对象、原因和影响；在当前已授权有限范围规划修正，不关闭规则或删除内容凑数。
- Mac锁定/缺界面能力：给出一个具体解锁或原生动作，继续独立资料/离线核验；解锁不作为未知动作重放许可。

最终交付说明哪些软件检查通过，哪些制造/装配/机械/实物仍待确认。旧阶段日志只按对应上下文查历史文件，不混入当前日常指南。
