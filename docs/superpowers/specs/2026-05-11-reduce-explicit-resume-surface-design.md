# Reduce Explicit Resume Surface Design

日期：2026-05-11

状态：设计已确认，暂不进入实施计划

## 背景

当前仓库已经明确了两条顶层方向：

- 普通文本默认是主路径
- bridge 应尽量减少存在感，避免把用户教成在操作第二套桥接产品

但在当前已落地方案中，`/codex resume <prompt>` 仍然在多个层面暴露得过重：

- README 仍把它列为常用显式入口
- V1 协议仍把它描述成显式续写主入口
- locale/help/fallback 文案里仍频繁出现 `resume`
- 测试断言里仍把 `resume` 当成默认教学示例之一

这会让用户感知偏向：

> “继续任务 = 记一个 bridge 命令”

而不是：

> “继续任务 = 直接继续和 Codex 说话”

本次设计不改变当前 `task/run` 模型，也不引入挂起的新产品主线。它只做一件事：

> 让当前旧方案的表面心智更接近“普通文本继续是默认”，而 `resume` 只是保留的兼容/兜底入口。

## 目标

1. 让“普通文本继续当前工作”成为仓库内外一致的第一叙事。
2. 保留 `/codex resume <prompt>` 的当前支持事实，但降低其用户表面存在感。
3. 统一 README、V1 协议、locale、测试口径，避免它们继续把 `resume` 描述成主教学路径。
4. 不触碰当前主线架构：不改 OpenClaw、不改 paired DM gate、不改 `task/run` 持久化与恢复规则。

## 非目标

本次设计明确不做：

- 不删除 `/codex resume`
- 不引入 `/codex <prompt>` 到当前活跃主线
- 不改 `task/run` 顶层连续性模型
- 不改 paired DM claim gate
- 不改审批、reply-plane、restart continuity 主逻辑
- 不把挂起的新方案偷渡进现有主线

## 设计结论

### 1. `resume` 继续存在，但降为兼容/兜底入口

当前仓库仍保留 `/codex resume <prompt>`，原因是：

- 它贴近当前原生 `Codex CLI` 的命名
- 它对老用户、极少数显式控制场景、以及某些恢复场景仍然有价值

但从用户主心智看，应把它降级成：

- 兼容入口
- 显式兜底入口
- 高级用户入口

而不是主教学路径。

### 2. “直接回复继续”应成为第一表述

凡是当前系统处于 `awaiting_input`、中断后可续、或其它“普通文本本就应该继续”的场景：

- 第一建议必须是“直接回复下一步”
- 第二层补充才允许提到 `/codex resume ...`

也就是说：

- 主动作：继续说
- 兜底动作：必要时显式 `resume`

### 3. 仓库叙事必须与当前运行时事实对齐

当前运行时事实其实已经偏向“普通文本继续是主路径”：

- 有活动 task 且 `awaiting_input` 时，普通文本会继续该 task
- 中断恢复后，也会优先提示直接继续

因此问题不在主逻辑完全错误，而在于：

- 文档
- help
- fallback 提示
- 测试示例

仍把 `resume` 说得太中心。

这次设计的本质是把表面叙事纠偏到与当前真实主路径一致。

## 用户可见目标状态

优化后，用户应感知为：

- 平时继续任务：直接回复消息给 Codex
- 新任务：`/codex --cd <path> <prompt>`
- 健康检查：`/codex doctor`
- `/codex resume <prompt>`：仍可用，但不是默认要记住的第一条命令

换句话说：

> “继续”不该表现成一个需要专门学习的 bridge 命令。

## 具体改动面

### 一、README 与对外入口文档

重点文件：

- `README.md`

要求：

- 把普通文本继续当前任务写成主路径
- `/codex resume <prompt>` 不再以“常用主命令”的语气居中展示
- 新任务仍以 `/codex --cd ...` 为显式入口
- `doctor` 仍保留为 bridge 唯一新增主命令

推荐表述方向：

- “继续当前任务” 不再优先写成一条命令
- 改写为 “若当前任务仍在等待输入，直接回复即可；如需兜底，也可使用 `/codex resume <prompt>`”

### 二、V1 协议叙事

重点文件：

- `docs/feishu-codex-bridge-v1.md`

要求：

- 保留 `/codex resume` 仍受支持的当前事实
- 但其角色从“显式续写主入口”改写为“保留的显式兼容入口”
- 在 `执行模型`、`/codex 命令面`、状态说明等位置都明确：
  - 普通文本是默认续写主路径
  - `resume` 只是兜底

### 三、contract / 治理口径

重点文件：

- `docs/contract-matrix.md`

要求：

- 不删除现有 `CS-002`
- 但要避免继续把 `resume` 写成用户主工作流的中心命令
- 更准确的治理语义应是：
  - bridge 支持显式 `resume`
  - 但默认续写主路径仍是普通文本

若现有矩阵文案已能兼容此含义，可不强制改 rule；但必须显式审视并确认没有叙事冲突。

### 四、locale / help / fallback 文案

重点文件：

- `extensions/codex-bridge/lib/locale.js`

要求：

- native help 中继续保留 `resume`，但降低排序与教学中心性
- `interruptedTaskRequiresContinue` 继续坚持：
  - 先提示“直接说明要继续做什么”
  - 再补一句“如需兜底，也可以使用 `/codex resume ...`”
- `taskAlreadyRunning`、`awaiting_input`、fallback 等文本中，不允许把 `resume` 当作第一建议
- 禁止出现“请使用 `/codex resume ...` 才能继续”这类主路径表述，除非该场景在运行时语义上确实只接受显式 `resume`

### 五、测试口径

重点文件：

- `extensions/codex-bridge/test/routing.test.js`
- 与 locale/help/usage 相关的 `runtime-compatibility` 断言

要求：

- 保留 `resume` 当前行为测试
- 增加或强化“普通文本继续是主路径”的断言
- 降低 `resume` 示例在帮助文案测试中的中心性
- 测试命名与预期文本不再暗示“resume 是默认继续方式”

## 收益

### 1. 更贴近北极星

不改主架构，也能让产品表面更像“远程用 Codex”，而不是“操作 bridge 的继续命令”。

### 2. 降低用户学习负担

继续任务的默认心智回到自然语言本身，而不是命令记忆。

### 3. 为未来潜在演进清理表层债

如果未来某一阶段真的重审更强的连续性模型，这一轮文案/协议治理不会白做。

### 4. 风险低

它不触碰：

- OpenClaw 依赖
- paired DM 边界
- `task/run` 持久化
- 审批与 reply-plane 主逻辑

## 代价

### 1. 需要多层同步，而不是只改首页

若只改 README，不改 V1、locale、测试，旧表述会很快重新冒出来。

### 2. 表层与底层仍会保留张力

底层仍是 old model，表面更像“plain text native continue”。因此措辞必须克制，不能谎称 `resume` 已经不存在。

### 3. 帮助入口会变得更“轻”，但更依赖一致性

一旦 locale 某处分支仍以 `resume` 为首要建议，就会破坏整体体验。

## 风险

### 风险 1：叙事过度前移

如果文案过于激进，会让用户误以为所有继续场景都完全不需要 `resume`。这与当前运行时语义不完全一致。

### 风险 2：治理与实现脱节

如果 contract / 文档 / locale / 测试不同步，就会造成“仓库说一套，运行时提示另一套”。

### 风险 3：老用户/恢复场景的显式入口被削弱过头

本轮只能降低存在感，不能把 `resume` 压到几乎不可见。

## 验收标准

完成后应满足：

1. README / V1 / 治理口径一致表达：
   - 普通文本继续是主路径
   - `resume` 是兼容/兜底入口
2. locale 文案一致：
   - `awaiting_input` / interrupted / fallback 场景下，第一建议永远是直接回复
3. 测试一致：
   - `resume` 行为仍被保护
   - 但不再作为默认教学路径被反复断言
4. 运行时主逻辑不变：
   - 不改变当前 route、task/run、approval、reply-plane 逻辑

## 可能影响的文件

- `README.md`
- `docs/feishu-codex-bridge-v1.md`
- `docs/contract-matrix.md`（视语义审视结果而定）
- `extensions/codex-bridge/lib/locale.js`
- `extensions/codex-bridge/test/routing.test.js`
- `extensions/codex-bridge/test/runtime-compatibility.test.js`

## 一句话结论

这轮不是删除 `resume`，而是把它从“当前表层中心命令”降级为“仍受支持、但不再主教学”的兼容入口，让当前旧方案在不重构主线的前提下，更接近“普通文本继续当前 Codex 工作”的低心智体验。
