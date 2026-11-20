# 日常使用与状态处理

用户可以直接说：“在这份工程副本上增加100kΩ电阻和10nF电容接3.3V/GND”、“把R4改成47kΩ的兼容0603料号，保持位置和连接”、“将R4第2脚从GND改接DRDY_N，移除它原来的局部地线，保留其他内容”。助手先读工程与真实库、形成影响清单，按公共流程实施并解释实际验收。用户不必提供内部ID、精确坐标或脚本。

## 检查和来源

doctor分别报告官方CLI、客户端版本、编辑器连接和能力。needs_ui只表示当前编辑器状态，closed文件复用无需新启动。open_project使用新读取副本，inspect_project返回当前工程/Board/图页；read_document给实例/脚/几何，read_connectivity给逻辑和pin→pad比较，read_pcb_routing给真实铜与规则。

模型读取不等于器件电气适用，型号数据表链接存在不等于内容已核对，价格/库存不能由EDA旧元数据推断。来源已有工作应由相应derive/resume入口建立正式新副本，不能将只读检查升级成可写。

## 新工程到交付

create_work_project需要原生空模板；已有明确原理图用derive_work_project。助手组织完整器件、所有引脚连接/NC和notes，draw_schematic先place读真实脚，再complete连线；verify_schematic与原生preview通过后保存/新磁盘核对。首次sync_pcb默认 importMode=review，用 apply → 目标PCB原生复核 → verify。显式 force_initial_empty 仅用于新空 PCB 的完整初次同步：完整原理图、工程模型、原生空板库存及规则前置指纹必须匹配，落盘一次意图后全量导入并重新核对。不能用于已有实例/ECO或反向同步；未知、超时、部分导入只读回同请求，不允许 retry_unapplied_review。API true与飞线均不是布通。

layout_pcb plan/apply/verify固定真实位置/板框，configure_pcb_rules只改任务当前规则并保留检查项/全局预设；新check_pcb的boardReady需要逻辑、布局、全部铜连通和新严格DRC。受限局部repair_pcb/incremental_pcb有完整来源与范围门禁；自动/文件路由的资格只按对应验收版本与上下文处理，未知引擎不重跑。当前单个工程成功不等于一般自动布通率。

save_work_project只请求保存；finish_work_project承担完整新磁盘/现场稳定/关闭证明。读取上下文用close_session回收，已销毁上下文不重复关闭。来源归属不明或用户窗口不清时保留。

## 已完成板修改

incremental_pcb支持普通孔移动/尺寸、同网线端更新、短线增删替换、普通孔线新增、可见位号，以及受限EP首组钢网分窗。plan之后源和参数冻结，未知不重放。工程独立钢网用prepare_model → 精确原生“仅选中实例”复制 → adopt_model → apply；共享/全局封装不写。导出完整原生档案不能用可能遗漏微线的API文档替代。

schematic_eco默认single_point为已验收测试点流程；两脚R/C新增、兼容换料与有创建来源的改接使用passives模式，读取passives.md。任意器件删除、更换不同几何封装、底层镜像、多页ECO及复杂用户支路自动重构尚未支持。

## 制造与常见停点

export_manufacturing从最终成品自动发现单板，生成本地Gerber/BOM/CPL、预览、报告和SHA清单。assembly=reflow/hand、viaTreatment按用户实际工艺；未指定孔处理保留unspecified。导出unknown时仅verify完整捕获文件，不重发原生导出、不换请求绕过。deliveryGenerated与manufacturingReady分开。

已完成交付需要更新派生图面时，复用同请求和原参数调用 `phase="refresh_previews"`。先验证原工程与完整交付清单，再从已捕获 CAM 和原生模型生成独立的同级 `-previews` 目录；原交付不改写，也不调用编辑器重新导出。重复请求只核对并复用来源、渲染版本和输出摘要一致的预览；不完整目录或来源冲突保留并拒绝。预览更新不改变原制造资格，图面仍需实际渲染检查。

- 复核未应用：保持目标PCB，只查看明确清单并应用一次，然后同请求verify。
- 原生替换未核验：保持准确原理图/目标，不再次替换；检查实际料号、保留身份/符号/封装设置及完整差异。
- 来源/参数冲突：检查是否用了正确成品/checkpoint/同请求原参数；新修改应从已闭合成果正式派生，不能手改旧记录。
- unknown写入/导出：保留现场和回执，读取当前实际结果；没有对应受限恢复证据就不重放。
- 保存或新磁盘不匹配：保留工作窗口，准确原生保存后再验证；不能把save true当完成。
- 几何/网络/非目标/DRC失败：报告实际对象、原因和影响；在当前已授权有限范围规划修正，不关闭规则或删除内容凑数。
- Mac锁定/缺界面能力：给出一个具体解锁或原生动作，继续独立资料/离线核验；解锁不作为未知动作重放许可。

最终交付说明哪些软件检查通过，哪些制造/装配/机械/实物仍待确认。旧阶段日志只按对应上下文查历史文件，不混入当前日常指南。

## 本地工程导入

create_work_project 可选择 projectImport 支线，把官方导出的 .epro/.epro2 交换文件通过 Offline Client Local Path 导入新的空目录；这与 blankTemplatePath 二选一。它只返回导入身份和隔离读回，不授予可写工作绑定。不能将 .eprj2 数据库或 .eprj3 目录当交换文件。原生导入权限不足、结果格式不支持或状态未知时保留回执与结果，不重发；可独立使用新建空模板继续正常绘图。

阶段性交付 synchronized_unrouted 时，两端保存和完整新磁盘核对仍必须通过；不要求无板框、未布线阶段的 DRC 全零，不添加临时铜/板框消除提示。A8 用正式 derive_work_project 携同一 circuit 与真实 closed checkpoint 接续，不重绘工程。

### 完成绘图后的标注整理

`draw_schematic(phase="tidy")` 可在首次同步前，复用同一 draw requestId 和完整 circuit，把本次绘图拥有的竖向导线网络名转为水平旁注，并把说明集中到器件上方。只接受已完成的导线/说明来源，先核对所有目标，再写入并读回显示位置；不改变器件、导线、端口、网络和值。动作有独立持久记录，未知结果不重放，重复完成请求只核对。整理后仍需检查原生预览，不能保证任意密集图自动无重叠。

## 已同步板的候选布局与官方路由

`layout_pcb` 的 `strategy` 默认为 `manual`，保持首次板框与约束位置流程。已有本任务板框、无铜且前置记录完整时，显式 `auto_candidate` 调用一次官方全板自动布局，允许范围是输入完整列出的实例；记录全部实际位置、锁定与完整模型/规则/原理图保持，候选的几何/电路约束评价单独报告。引擎 success 或处理数量不是最终布局资格。候选捕获后，以新布局请求 `strategy="adjust"` 正式采用完整约束位置，保留同一板框；候选未采用时不进入路由。unknown 只能读回原请求，换请求或模式不能绕过。

`route_pcb` 先通过 critical 阶段建立实际关键铜，再 native 阶段使用本机声明的 RoutingNets、keep、图层与枚举参数。原生预算支持现有30–180秒输入，CLI进程预算额外3秒，journal记录真实预算；普通读取仍默认15秒。引擎回执、旧铜身份保持、新铜范围、全原生记录、严格DRC和物理连通分别核验。官方格式声明中的新增标量LINE转换占位记录仅作有界元数据单独报告；不得忽略任何真实铜或模型记录。

公共PCB预览同时纳入器件和板框。最终 check/finish 检查完整档案及新磁盘状态；制造导出在closed成品后进行，孔径、插接外形、板厚/表面工艺及装配方式仍按实际资料单列。doctor仅报告接口/桥接可用性和具体流程已有资格，不通过一次静态检测宣称当前引擎已布通。

## 已闭合工程的自由说明更正

使用 `schematic_eco mode=notes` 从有完整 closed 证明的单页成品正式派生。derive/read → plan(noteChanges) → schematic → verify/preview → finish；同请求 closed 复用保持只读。每次最多3个独立页 TEXT，仅 text 与 atMm（坐标转为原理图10mil单位，存储Y反向），必须给实际读取的 id 与 expectedText；不支持 ATTR、网络标签、符号内文字、删改其他图元或同步PCB。plan 绑定完整旧体与实际API属性；所有原理图非目标与PCB档案、规则、逻辑严格保持，逐步持久意图，未知写入不重放。完整保存、新磁盘重读和铜/DRC核查通过后关闭。

V4.1.71 实测：TEXT.modify 可以改变界面对象但未进入完整存储档案，官方 save 也未提交；单体get与getAll还存在对齐枚举不一致。不能据界面读回或save true放行。本轮保存了这次精确首条失败/零存储变化证据；complete只允许一次限定保存探测，失败不重放。prepare_notes/adopt_notes仅在该已证明条件下准备原生属性面板并采用全冻结计划的完整档案结果；不是任意unknown恢复。read保持设计只读。recover仅在既有工作上下文已确认关闭、文件与已验证closed来源逐字节一致且属于上述精确失败时，允许一次原路径恢复；保留旧open/unknown/保存探测，完整档案与TEXT API旧体重核后才接受新绑定，未知打开不得重试。实测原生文字属性面板已成功提交两处内容更正，但坐标整理及最终闭合尚未完成；不承诺通用自由说明编辑能力。

阶段性原理图可在 circuit.openPins 中逐脚列出后续待接引脚。保存与重开必须验证这些脚的网络为空且无 NC 标记。circuit.nets[].junction 以原理图 API 的 10 mil 坐标指定连接点，插件依据真实实例的引脚位置和朝向生成正交导线。带 junction 的阶段调用 tidy 时，以已记录的导线身份整理分支标签并保留已排好的说明。

### 已同步未布线的首颗 VDD 去耦

在隐藏副本以 `schematic_eco mode=unrouted_decoupling` 提供已关闭的未布线工程、原工作记录、新目录和同一 requestId。按 derive → plan → schematic → sync → verify_sync → finish 推进。unroutedCircuit 在原电路上新增一颗已核实的两脚 MLCC，一端和一个原留空 VDD 脚接新电源网，另一端接已有 GND。新电源网的 junction 按引脚几何给定。既有器件、脚位、工程内封装和零独立铜对象均须在读回时匹配。若原生同步已经返回，可用 verify_sync 只读核对同一次导入。

查询焊盘或符号几何时，read_library_model 使用 `view=geometry`。工程内模型使用当前项目库身份和本地模型 UUID。省略 view 时保留原有源码和指纹读法。

已有数字电源网可在同一 unrouted_decoupling 模式提供 digitalPowerPairs。各项指定新电容位号 capacitor、数字电源脚 vdd 和对应地脚 vss。沿用工程中已核实的同款 100 nF 去耦电容，新增器件与连接写入 unroutedCircuit。额外的 VSS 可单独接入 GND。先按厂家封装资料核对脚号，再以原生网表验证所有 VDD/VSS 和原有连接。已有电源网、PCB 规则和原有封装逐项保持。

STM32H563VI 采用片内 LDO 时，先核对 ST 引脚表和供电图，使用同一模式的 `vcapPairs` 指定两组 `{capacitor,pin}`。48、98 脚共用 VCAP，每脚各配一颗 2.2 µF，两个回流端接数字 GND。该操作核实原生引脚、同款电容和工程内封装，保存后逐脚比较。

STM32H563VI 使用滤波后的 3.3 V 作为外部 ADC 基准时，`analogSupply` 指定磁珠 `bead`、0 Ω 地连接 `groundLink`、按 1 µF/100 nF/10 nF 排列的 `vddaCaps` 和按 1 µF/100 nF 排列的 `vrefCaps`。一只磁珠从 +3V3 馈电，21、22 脚共用 +3V3A，19、20 脚共用 GNDA。先核实官方引脚和器件参数，再在已同步、未布线副本上规划和验证。

STM32H563VI 的 `usbBackupSupply` 可在同一类副本上添加 VDDUSB 与一次电池后备电源。指定电池座 `holder`、串联隔离二极管 `diode`、USB 的 `usbBulk` 与 `usbBypass`、VBAT 的 `backupBypass`。第 73 脚用数字 +3V3，6 脚用隔离后的 VBAT。工程采用经过触点、符号和焊盘核对的固定料号，CR2032 充电功能保持关闭。

STM32H563VI 的 `lse` 增量指定 `crystal`、`loadIn`、`loadOut` 和已有的 `holder`。先按厂家俯视图修正唯一使用的 BS-08 工程封装的 2 号焊盘外侧两个角，通过正式工程交换文件导入并核对完整原理图及 PCB 来源。确认 8、9 脚及 SSP-T7-F 的 1、4 振荡端，为 2、3 脚保留外部不连接。

STM32H563VI 的 `bootReset` 增量使用 `crystal` 指定 SSP-T7-F，`pullDown`、`filter`、`resetSwitch` 和 `bootSwitch` 指定启动、复位元件。仅从已验收的 LSE 副本派生，按精工焊盘图对称调整两排焊盘，核对真实铜面。两路常开触点分别将 BOOT0 接至 +3V3、将 NRST 接至 GND。

STM32H563VI 的 `swdConnector` 增量用 `header` 指定五针直排针，`resetSwitch`、`bootSwitch` 指定仅有的两处韩下轻触开关实例。两处工程铜面均与厂家推荐尺寸核对。J201 从 1 到 5 依次接目标 +3V3 参考、SWDIO、SWCLK、GND、NRST。这个单排接口按信号接转接线。

`usbData` 用于 STM32H563VI 自供电的 USB 2.0 从设备。指定汉博 MC-121-L119 母座 `jack`、USBLC6-2SC6 `esd`、两颗 5.1 kΩ 下拉 `cc1`、`cc2`、33 kΩ 和 47 kΩ 分压 `senseTop`、`senseBottom` 以及端口电容 `bulk`。PA11、PA12 分别接 D−、D+，PD13 读 VBUS。A8、B8 标为 NC。一个 EH 符号脚对应四个接地镀槽，验收分别计算逻辑引脚与物理焊盘。

`bulkDecoupling` 接受两个新电容位号，在已有的 +3V3 和数字 GND 间并联两颗同型号 4.7 µF、0805、X7R 电容。先核实 H563VI 的五组数字供电和已有局部去耦。新电容 1 脚接 +3V3，2 脚接 GND。只在已同步、未布线副本使用。

`layout_pcb` 的手动首版布局可使用 2 或 4 个铜层，最多 200 个器件。`board.cornerRadius`、`board.mountingHoles` 与其余几何使用同一单位。安装孔为带孔径和螺钉避让直径的独立非镀圆孔，孔心使用 PCB 全局坐标。板框原点是左上角，+Y 向上。验收时读回所有器件的位置、面和角度、板框圆角和孔位，并在新磁盘上下文核对完整设计。未布线阶段保留预期的未连接报告。

已收尾的未布线布局通过 `resume_work_project` 从来源工作目录派生。新副本沿用已验证的板框、安装孔、全部位姿和原生规则，可用 `route_pcb` 的 critical 模式逐支路布线。用 `check_pcb` 和 `finish_work_project` 在磁盘重开后逐网检查铜线与 DRC。
