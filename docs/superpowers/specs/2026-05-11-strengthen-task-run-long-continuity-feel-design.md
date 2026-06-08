# Strengthen Task-Run Long Continuity Feel Design

日期：2026-05-11

状态：设计已确认，暂不进入实施计划

## 背景

当前仓库的连续性主模型已经相对稳定：

- `task` 是用户可见连续 lane 的锚点
- `run` 是该 lane 内的一次具体执行
- 普通 run 完成或失败后，task 默认回到 `awaiting_input`
- 中断恢复后，普通文本仍默认续到同一 task

也就是说，底层语义其实已经比“任务工单系统”更接近连续对话。

但从用户感知看，当前产品仍有几个地方显得偏“任务系统”而不是“长期连续工作脉络”：

- `completed`、`task finished`、`task aborted` 这类表述容易给人“这条脉络已经结束”的感觉
- finish card 更像单轮任务终点，而不是“本轮完成，仍可继续”
- 文档与状态命名中，`task` 的生命周期感有时强于“同一脉络连续推进”的感觉
- 带 `taskId` 的提示在某些场景下会增强系统对象感，而不是弱化 bridge 存在感

这与当前北极星并不完全冲突，但与“用户应尽可能感知自己在持续远程使用 Codex”相比，仍有优化空间。

## 目标

1. 在不改变当前 `task/run` 模型的前提下，加强“这是同一条长期工作脉络”的用户感受。
2. 保持当前 continuity、recovery、approval、reply-plane 行为不变。
3. 弱化用户表面上的“任务终结感”，强化“本轮结束但仍可继续”的表达。
4. 让 finish / recovery / status / docs 对当前 `task/run` 语义的叙事更加一致。

## 非目标

本次设计明确不做：

- 不把顶层对象从 `task` 改成 `lane` 或 `thread`
- 不改持久化结构
- 不改 `activeTaskId / lastTaskId` 语义
- 不取消 `completed / aborted` 这些内部状态
- 不引入挂起的新产品主线
- 不新增新的用户命令或多-lane 管理入口

## 设计结论

### 1. 保持当前 `task/run` 模型，但把用户表面解释成“同一脉络中的一轮执行”

当前仓库的真实语义已经是：

- `task` 比单次工单更像用户当前工作的连续 lane
- `run` 才是单轮执行

因此应把用户可见文案、协议描述、卡片语言，进一步朝这个事实收口：

- “本轮执行完成”
- “可以直接继续”
- “上一轮执行中断”

而不是优先强调：

- “任务已完成”
- “任务已终止”
- “当前没有任务了”

### 2. `completed` 应更多被叙述为 run 终态，而非用户脉络终态

内部状态可以继续保留 `task.status = awaiting_input`、`run.status = completed` 等现有模型。

但对用户表面的语言，应优先使用：

- 这一轮完成
- 可以继续下一步
- 当前脉络仍然保留

换句话说，不能让 `completed` 在用户心理上被误读成“对话已自然关闭”。

### 3. finish card 应成为“结果锚点 + 连续邀请”，而不是“终结卡”

当前 finish card 已经承担结果锚点角色。本轮优化应继续收口它的语气：

- 保留结果锚点职责
- 不把它写成“流程彻底结束”的强终态提示
- 在合适场景下允许最薄地表达“如需继续，直接回复”

这里的关键不是增加新内容，而是避免语言把用户推回“我需要重新开一个任务”的误解。

### 4. interrupted / recovery / failed-but-resumable 场景应统一长期脉络语言

当前系统已经有较好的中断恢复语义，例如：

- 上一轮执行中断
- 普通文本默认可以继续

这一套语言需要与 finish / status / help 统一，形成一个一致的连续性感知：

- running：还在同一脉络里
- interrupted：上一轮中断，但脉络还在
- completed：这一轮完成，但脉络还在
- denied：这一步被拒绝，但脉络还在

### 5. 诊断信息与用户主回复要继续分层

当前仓库里 `taskId`、`sessionId`、运行状态等信息仍然有运维价值。

设计要求不是删除它们，而是继续分层：

- 诊断、doctor、debug、状态卡可以保留这些对象信息
- 主路径 finish/recovery/help 文案应尽量少让用户直接面对“系统对象管理心智”

## 用户可见目标状态

优化后，用户应更自然地感知成：

- 长任务仍在同一张卡上持续推进
- 本轮做完了，但我可以直接继续说下一步
- 上一轮如果中断，也还是在同一条工作脉络里继续
- 被拒绝或失败的是“这一轮动作”，不是“整条工作脉络”

一句话：

> 不是“任务系统在不断开单结单”，而是“同一条远程 Codex 工作脉络在持续推进”。

## 具体改动面

### 一、finish / status / recovery 文案收口

重点文件：

- `extensions/codex-bridge/lib/locale.js`

要求：

- 对 `awaiting_input + run completed/failed` 的文本，优先表述为“本轮完成/失败”，并明确可以继续
- 对 `completed task` 这类强终态措辞做语气收口，避免在可续场景下误导用户
- 对 interrupted/recovery 文案保持与 finish 文案同一套连续性叙事

### 二、V1 协议中的连续性说明更明确地区分 task 与 run

重点文件：

- `docs/feishu-codex-bridge-v1.md`

要求：

- 当前文档虽已写明 `task` 与 `run`，但还可更强地强调：
  - run 完成或失败后，task 默认回到 `awaiting_input`
  - 对用户而言，这意味着“同一脉络继续”，不是“系统自然结案”
- finish / reset / restart 等章节应继续避免把 task 写成一次性工单

### 三、帮助与 README 的连续性表述要更一致

重点文件：

- `README.md`
- 相关 help 文案

要求：

- 在介绍默认工作流时，更强地强调“继续当前工作就直接回复”
- 弱化“任务已结束后需要重新进入某种流程”的暗示

### 四、测试断言要开始保护“长期连续感”

重点文件：

- `extensions/codex-bridge/test/routing.test.js`
- `extensions/codex-bridge/test/runtime-compatibility.test.js`
- 与 finish/recovery 文案相关的测试

要求：

- 继续保护现有 continuity 行为
- 新增或强化这些用户感知断言：
  - interrupted guidance 继续强调“直接继续”
  - completed/awaiting_input 场景不应被描述成 lane 自然关闭
  - finish/recovery 文案要一致地表达“同一条脉络可继续”

## 收益

### 1. 更接近远程原生 Codex 感

用户会更少地感知到“bridge 在管理任务对象”，更多地感知到“我在持续推进同一条 Codex 工作脉络”。

### 2. 不改主模型，却吸收新方案最核心的体验收益

挂起的新方案里最有吸引力的一点，是 persistent lane 的体感。本设计尝试在不改顶层对象的前提下，吸收其中最重要的体验收益。

### 3. 与 restart continuity、running-card liveness、reply-plane 更一致

仓库已有这些方向：

- restart 后默认续同一 task
- 长任务维持同一张 running card
- finish card 只做结果锚点

这次设计会把它们在用户语言上进一步统一成“同一脉络持续推进”。

## 代价

### 1. 需要更精细的措辞控制

如果文案收口过头，容易把真实 `task/run` 差异说没了；如果收口不足，又达不到目标体验。

### 2. 会出现“内部状态名”与“用户表面叙事”分层

这不是坏事，但要求实现与测试都承认这种分层，而不是混写。

### 3. 需要补足测试来防止回退

单纯改文案不够，必须让连续性感知成为被保护的体验契约。

## 风险

### 风险 1：把“长期连续感”说过了头

当前主线仍不是 persistent lane 新方案。若表述过度，容易造成“产品说像 thread，底层还是 task”的理解错位。

### 风险 2：对失败/终止场景表述失真

某些场景确实应明确告诉用户“这轮失败了”或“任务已终止”。长期连续感不能覆盖真实故障语义。

### 风险 3：过多弱化对象信息，影响运维可观察性

`taskId`、`sessionId` 等对象信息不能从诊断面消失；只是不应在主路径里抢戏。

## 验收标准

完成后应满足：

1. finish / recovery / interrupted / awaiting_input 文案一致表达：
   - 当前脉络仍可继续
2. README / V1 协议中的连续性叙事更明确地区分：
   - `task` 是连续锚点
   - `run` 是单轮执行
3. 测试开始保护“长期连续感”的关键表述
4. 运行时主逻辑不变：
   - 不改变现有 persistence、approval、restart continuity、reply-plane 主行为

## 可能影响的文件

- `extensions/codex-bridge/lib/locale.js`
- `docs/feishu-codex-bridge-v1.md`
- `README.md`
- `extensions/codex-bridge/test/routing.test.js`
- `extensions/codex-bridge/test/runtime-compatibility.test.js`

## 一句话结论

这轮不是把当前 old model 改成 persistent lane，而是在保持 `task/run` 主模型不变的前提下，把用户感知进一步收口成“同一条远程 Codex 工作脉络在持续推进”，从而吸收挂起新方案中最有价值、但风险最低的一部分体验收益。
