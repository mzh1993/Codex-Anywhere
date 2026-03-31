# DM-Scoped Full Access Alignment Design

## 背景

当前 bridge 已经具备两条高权限路径：

- bridge 自有动作审批后执行
- `codex task` 经审批后以 `riskLevel: "high"` 启动

实现上这两条路径是分开的，导致用户在 paired DM 里感知到“我刚批准过高权限，但后续 Codex 任务仍不是 Full Access”的割裂体验。这与顶层三件套已经确认的目标不一致：用户应尽可能感知自己在使用原生 `Codex`，而不是学习 bridge 的分层语义。

## 目标

- 让 paired DM 的权限心智对齐原生 Codex 的“开启完全访问权限”
- 权限状态以 DM 为作用域持久保存，而不是只绑定某一次 run
- 后续显式 `/codex ...` 新任务、`/codex resume ...` 续写、以及同 lane 的继续输入，默认继承该 DM 的 Full Access 状态
- `reset` 或显式降权后，DM 回到普通权限

## 非目标

- 不新增新的厚桥自然语言语义
- 不把 bridge 自有动作和 `codex task` 混成同一执行器
- 不承诺桥在宿主能力缺失时“魔法式”获得 GPU / systemd / 宿主总线访问

## 设计裁决

### 1. 权限状态模型

在 sender profile 上增加 DM 级权限状态：

- `accessMode: "normal" | "full_access"`
- 可选审计元数据：最近一次授予来源、时间

该状态只表达“此 DM 已被明确授权为 Full Access 默认模式”，不表达宿主一定满足所有设备/总线能力。

### 2. 授权入口

当用户通过 bridge 现有高危确认入口，明确同意进入 Full Access 语义时：

- 不再只创建一次性的高风险 run
- 同时把该 DM profile 持久化为 `full_access`

这样后续同 DM 的任务默认沿用 Full Access，而不是重新回到普通模式。

### 3. 任务继承

`startTask` 的默认 `riskLevel` 不再只看显式参数和 existing task：

- 若显式指定风险级别，显式值优先
- 否则若 existing task 存在，沿用 existing task
- 否则读取 DM profile 的 `accessMode`
  - `full_access` => `riskLevel: "high"`
  - `normal` => `riskLevel: "normal"`

这保证显式新任务和显式续写都能继承 DM 级权限状态。

### 4. 清理与降权

以下事件必须清空 DM 级 Full Access：

- upstream `before_reset`
- bridge 自有 reset 清理链路
- 后续若实现显式降权命令，也走同一 profile 字段回写

原则是：Full Access 可长期记住，但只能由显式降权或 reset 结束。

### 5. 能力与权限分离

DM 被授予 Full Access，只代表 bridge 会以高权限参数启动 Codex。

若当前运行时本身缺少宿主能力，例如：

- 没有 `/dev/nvidia*`
- 没有 systemd user bus
- 没有对应设备挂载

系统必须如实暴露“已按 Full Access 方式启动，但宿主能力不可见”，而不是把能力缺失伪装成未授权，或反过来把未获得宿主能力说成已经完全可用。

## 用户可见行为

- 用户首次触发并批准高权限后，这个 paired DM 进入 Full Access 默认态
- 后续 `/codex --cd ...` 可像原生 Codex 一样直接进入高权限任务
- 后续普通继续输入沿用同 lane，不再出现“刚批准过却又像没批准”的体验
- `reset` 后回到普通权限，重新需要显式确认

## 测试要求

- profile 可持久保存并读取 `accessMode`
- 审批通过后，profile 进入 `full_access`
- 后续显式新任务默认变为 `riskLevel: "high"`
- 后续显式续写默认变为 `riskLevel: "high"`
- `before_reset` 清空 `accessMode`
- 运行时能力缺失时，状态/文案不谎称宿主能力已具备
