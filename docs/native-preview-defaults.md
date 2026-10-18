# 原生封装预览配置的限定比较

A9-R1，0.11.0-dev.a9-r1。本规则仅用于已核实真实换料目标所保留的工程内 FOOTPRINT；不修改模型或原始归档。

## 来源

官方格式文档 commit `9e42727cc4cf13a8e442140e8e7794ae94d5f41b`：
- https://github.com/easyeda/easyeda-format-skill/blob/9e42727cc4cf13a8e442140e8e7794ae94d5f41b/primitives/FOOTPRINT/net.md
- https://github.com/easyeda/easyeda-format-skill/blob/9e42727cc4cf13a8e442140e8e7794ae94d5f41b/primitives/FOOTPRINT/primitive.md

本机 V4.1.71，官方安装包 `pro-pcb/4.1.61.12d72298/js/pcb.js` 与 `pro-ui/4.1.73.d7ac750f/js/ui.js`，完整摘要和精确字符偏移保存在 A9-R1 的 local-*.json。字段说明来自 pro-api/0.3.48.e3a64c76 的 format-types.schema-ZEA4IXWZ.json。新版 schema 将 display 标成必填，实际旧版颜色配置序列化会省略无值字段，因此不把新版 schema 当作本机默认体证据。

NET 是按网络名登记附加设置，连接关系来自图元及 PAD_NET/FOOTPRINT_NET。安装包 cd 构造器默认 class/equalLength/differential/color=null、showRatline=true；isPositiveNet getter 在无差分时返回 false。CEA 读取器在相关名字非空时才建立差分/等长关系，类型非 null 时才分配网络类。NET 序列化器从这些 getter 写出六字段。因此只接纳空名字、这六个精确默认字段的新增记录；不接纳任何非空网名、属性变化或字段扩展。NET 的默认配置等价不表示可以省略焊盘网络及全板连接证明。

PRIMITIVE 是渲染/拾取配置，其 DRC/BOARDSHAPE/PARTITION 名称不是对应几何记录。安装包 getDisplayColor、画布颜色表及 serializer 读写这些配置；DRC 检查、BOARD/LINE/PAD/RULE 等记录另行保存。ALL 56/false 与 PROPERTY 0/false 是实际器件管理器预览筛选，其他项为实际捕获的默认颜色。只注册代码内逐项列出的完整体，不概括接纳所有颜色或显示字段。

## 比较约束

调用者传入已经匹配的保留封装 ID。新初始化分支要求前后均 FOOTPRINT、唯一活动 ID、唯一且不变的来源 META、初始配置不存在、所有原记录及 tombstone 完全保持、新记录全部属于精确的 13 项表。保存每条 before/after、源和排除这些精确配置 ID 后的完整模型锚点。后续恢复仅允许已登记条目的精确原体/缺席；磁盘比较验证来源与锚点，再对这些记录做内存内规范化。额外字段、重复、模型类型、来源或几何变化均不会被规范化。

旧 ALL 0/true→56/false、PROPERTY 缺席→0/false 两例继续适用；不扩大其体或模型类型。完整档案比较额外拒绝模型类型变更和重复活动 ID，包括原先未覆盖的新增配置重复。原始 SHA、完整记录、删除、引脚到焊盘网络及 DRC 证明分别保留。

## 本次恢复条件

A9 第一次 adopt_replace 已完整捕获，partProof matched，但保持证明失败，代码在 replace-save 前返回；journal 没有 replacement、保存 intent 或同步 intent。本次仅沿同 requestId 再读取验证已发生的替换；证明通过后首次发出保存，不重放替换。该条件不是 unknown 写入的通用重试许可。

A9-R1 后续正常 PCB 导入还实测到声明目标 C1 的存储角度 270→-90。仅在既有目标 uniqueId/原实例映射、真实料号/保留模型与完整其余属性保持路径内，接纳 [-360,360] 内精确 90 整数倍且相差整周的表示；不使用角度容差，不接纳实际转角、额外整周或任意非目标变化。原始 before/after 和 angleRepresentation 证明单列。此处是已声明目标的比较期望值，不是全档案角度归一化。9 个真实 PCB 捕获用例与默认测试覆盖；原全局保持 270→-90 未声明变化仍拒绝。
