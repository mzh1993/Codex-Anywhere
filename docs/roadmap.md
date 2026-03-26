# Roadmap

> Capability-gap-first roadmap. This document translates the north star into build priorities.

## 使用方式

- 这不是按渠道排的路线图。
- 这不是按“哪个功能先看起来酷”排的路线图。
- 这是按产品本体缺口排序的路线图：先补执行核心，再补结构保障，最后放大协作体验。

## 优先级原则

- `P0`：先把系统做成可信的受控 Runner
- `P1`：再把系统做成可恢复、可扩展的远程执行平台
- `P2`：最后把系统做成低认知负担、强协作感的产品体验

## P0：打牢本体

### 1. 受控执行能力

目标：把“允许 / 审批 / 拒绝”从提示词级判断推进到执行边界级约束。

工作包：

- 定义允许区、审批区、拒绝区的稳定边界模型
- 按动作类别而不是 prompt 表面语义做风险判断
- 统一审批前、审批中、审批后的状态与提示
- 把拒绝语义产品化：拒绝后仍保持可解释、可继续
- 建立边界回归测试：允许、审批、拒绝都能自动验证

完成标志：

- 团队可以稳定回答“为什么这个动作允许/审批/拒绝”
- 边界回退会被测试直接发现

### 2. 任务状态机能力

目标：把任务连续性做成系统级协议，而不是聊天行为碰运气。

工作包：

- 收紧 task status 与 run status 的权威定义
- 建立输入协议矩阵：不同状态下允许哪些输入
- 统一新任务、继续、审批后继续、中断后恢复的连续性语义
- 明确中断与恢复规则：默认自然语言恢复，必要时才使用兜底 continue
- 持续压缩状态提示噪音与歧义
- 建立状态机回归测试矩阵

完成标志：

- 用户始终知道当前状态、下一步允许什么
- 渠道输入不会绕开状态机

### 3. Bridge 自有控制面能力

目标：把本仓库专属宿主控制面动作从 `codex task` 中切开，交给 bridge 以可审批、可审计、不中断连续性的方式处理。

工作包：

- 定义哪些动作属于 bridge 自己的宿主控制面，而不是普通 Codex 工作内容
- 建立 `codex task` 与 `bridge action` 的 owner 与连续性分离规则
- 明确审批、拒绝、执行、结果回传的最小闭环
- 让控制面动作执行后自动回到原有 Codex 连续性，而不是污染 task 上下文
- 建立控制面回归测试：批准、拒绝、解释、回退都可验证

完成标志：

- 本仓库控制面动作不再依赖 Codex prompt 平面“想办法执行”
- 完成一次控制面动作后，用户可以无缝回到原来的 Codex 工作流

## P1：补强系统

### 4. 恢复与审计能力

目标：让异常、中断、重启都成为协议的一部分，而不是黑盒故障。

工作包：

- 明确 task 与 run 的持久化边界
- 定义中断后的安全回收策略
- 统一恢复提示协议
- 明确审计最小完备集
- 增加 profile、task、approval、run 之间的状态漂移防护
- 建立恢复与审计回归测试

完成标志：

- 用户不会因中断失去任务连续性
- 团队可以追溯一次远程执行的关键路径

### 5. 渠道解耦 contract

目标：让 Feishu、微信、Web 都只是入口适配层，而不是执行语义来源。

工作包：

- 定义统一输入协议
- 定义统一输出协议
- 收紧入口适配层边界：只做鉴权、去重、路由、渲染
- 吸收渠道差异于 adapter 层，不反噬核心
- 形成新渠道接入模板
- 增加 contract 级测试

完成标志：

- 新增渠道时不需要重写执行核心
- 同一输入语义在不同渠道上得到同一核心结果

## P2：放大体验

### 6. 协作体验编排能力

目标：把当前“文本 + 状态 + 审批”的可用 V1，推进到低认知负担的协作体验。

工作包：

- 收敛文本体验：更短、更准、更一致
- 结构化表达状态：当前任务、风险、最近一步、下一步
- 优化审批体验：降低误操作率
- 回传中间结果与阶段性观察
- 支持图片、图表、渲染结果等可视结果
- 增强任务回顾与上下文回接
- 建立体验层的低认知负担设计规范

完成标志：

- 用户会感受到“这不是机器人，而是可以持续协作的系统”
- 渠道能力开始成为体验优势，而不是执行语义来源

## 版本映射建议

### V2

- 以 `受控执行能力 + 任务状态机能力 + Bridge 自有控制面能力` 为主
- 目标：把当前 V1 原型推进到“可信、连续、边界清晰”的受控 Runner

### V3

- 以 `恢复与审计能力 + 渠道解耦 contract` 为主
- 目标：让系统具备长期演化与多入口扩展基础

### V4

- 以 `协作体验编排能力` 为主
- 目标：把远程执行系统推进到真正低负担、强协作感的产品体验

## 当前落地与缺口

### 已落地（截至 2026-03-26）

- 当前 `codex-bridge` 全量回归基线仍为 `node --test extensions/codex-bridge/test/*.test.js`，且已在本轮变更后重新验证通过
- `P0 / 受控执行能力` 已有可回归的最小边界：`cwd` 内写入、`cwd` 外写入、`~/.codex`、`~/.openclaw`、宿主秘密目录、service/process/scheduler/remote/container/publish/global env/destructive 等都已有 allow / approval / deny 语义与测试
- `P0 / 受控执行能力` 已继续收紧一层：`discussion/read-only` 意图已被提升为显式内部信号，单纯讲解或复盘高风险命令/单元名时，不再因为表面词命中就漂移成审批
- `P0 / 任务状态机能力` 已有明确协议：`no_task / awaiting_input / running / awaiting_approval` 的输入矩阵、自然语言续写、自然语言审批、恢复后继续、内部事件静默、`cwd` 只影响未来默认值等都已落地
- `P0 / 高风险审批能力` 已完成一轮关键收紧：审批消费已贴近 run-start，失败启动不会吞掉 approval token；`approve_with_tail` 只允许不放大边界的补充要求，新增 bridge-owned / denied tail 会保持原审批挂起
- `P0 / 高风险审批能力` 已补上最薄 typed `approvalGrant`：当前只覆盖 `codex task` 的下一次获批 run；审批记录会持久化 `grantType / taskId / approvalToken / action / intent / promptDigest / executionBoundaries / effects`，并在真正启动前复核；若 grant 与当前 run 不一致，则保持原审批未消费
- `P0 / 高风险审批能力` 已补上显式单次消费语义：获批 run 成功进入启动路径后会标记 `consumedAtMs`；即使删除审批文件滞后，同一 approval token 也不能再次启动第二次 run
- `P0 / 高风险审批能力` 已把泛化 `host_mutation_requires_approval` 继续收口为更稳定的 typed reason：`host_codex_boundary_requires_approval`、`outside_cwd_write_requires_approval`、`install_lifecycle_requires_approval`
- `P0 / Bridge 自有控制面能力` 已有最小闭环：仓库自有 service control 会进入独立 `bridge action`，并与 `codex task` 的 continuity、approval lane、summary / next steps 持续分离
- `P0 / Bridge 自有控制面能力` 的劫持边界已更保守：纯仓库自有控制面请求仍归 bridge，但混合任务语义默认回落给 Codex，不再被 bridge 过早接管
- `P0 / Bridge 自有控制面能力` 已继续补上反误劫持护栏：除显式混合语义外，shorthand repository viewing 与 trailing ordinary verb 这类残留普通工作语义也已被回归测试锁定为默认回落 `Codex`
- `P0 / Bridge 自有控制面能力` 已补上最小 typed contract：`bridge action` 持久化会固定保存 `contract(kind / operation / target / executor)`，执行前若记录与 contract 不一致则 fail-closed
- `P1 / 恢复与审计能力` 已有基础底座：task / run / approval / bridge action 持久化已分开，stale running task 与 stale running bridge action 都有 fail-closed recovery，且有中断提示与回归测试
- `P1 / 恢复与审计能力` 已补上最小 trace：`bridge action` 会持久化 `trace.execution` 与 `trace.recovery`，先保证执行与恢复可回溯，再谈更高层审计视图

### 还差什么

- `P0 / 受控执行能力` 仍未完全从“prompt / regex / path 混合判断”升级到“执行边界级约束”；虽然 `discussion/read-only` 与路径边界已经开始拆开，但整体仍依赖不少表面语义匹配，离真正稳定的 action-boundary model 还有距离
- `P0 / 受控执行能力` 的下一步不应再继续堆 prompt-level 特判，而应先把 policy 内部收敛成稳定的 `intent / execution boundaries / effects / decision` 对象，再逐步推进更强的 boundary / capability 模型
- `P0 / 高风险审批能力` 虽然已经落下最薄 typed `approvalGrant`，但它仍不是通用 capability object；当前仍主要依赖 policy assessment 重新生成并校验 grant 摘要，离更稳定的 action-boundary / capability 模型还有距离
- `P0 / 高风险审批能力` 的下一步仍应保持克制：typed grant 继续只服务 `codex task` 的下一次获批 run，不提前统一 `bridge action`，也不把控制面审批抽象成跨对象通用票据
- `P0 / Bridge 自有控制面能力` 虽然 contract 已收口，但当前 action surface 仍偏窄，主要覆盖仓库自有 service、gateway 健康检查、install lifecycle、diagnostic；后续仍需继续谨慎审计等价表达与 executor 边界
- `P1 / 恢复与审计能力` 还停留在工程可恢复层：虽然已有最小 `trace.execution / trace.recovery`，但仍缺 end-to-end trace 汇总、状态漂移总览、面向操作者的审计视图与更完整的恢复解释
- `P1 / 渠道解耦 contract` 还没真正抽稳：当前核心语义仍主要长在 Feishu + OpenClaw 这条接线里，还没有稳定的新渠道接入 contract 与模板
- `P2 / 协作体验编排能力` 基本尚未展开：结构化状态、低噪音阶段回传、图片/渲染结果、任务回顾与更低认知负担的体验层都还在后面

### 当前最重要

- 当前唯一最高优先级：继续把 `P0` 做硬，优先收口 `action-boundary model` 与高风险审批语义，先把现有受控 Runner 做稳。
- 在此之前，不为新渠道、体验花样或 bridge 扩权提前改动核心语义；后续凡是交互、审批、恢复、bridge 路由改动，都先过 `docs/product-decision-baseline.md` 的“第一原则检查清单”。

### 第一原则审计结论（2026-03-26）

- 当前未发现 `north star` 自身存在逻辑冲突；主线仍清楚：`Codex-first`、`bridge-thin`、审批单次且 run-scoped、`bridge action` 独立且不污染 `codex task` continuity。
- 当前 `product-north-star`、`product-decision-baseline`、本路书、`feishu-codex-runner-v1`、实现与回归测试已基本对齐；没有发现“文档这样说、实现朝反方向走”的明显漂移。
- 当前真实缺口不在第一原则，而在落地硬度：`P0 / 受控执行能力` 仍部分依赖 prompt / regex / path 信号源，尚未完全升级到更稳定的 action-boundary / capability 模型。
- 因此后续推进重点不是重写北极星，而是继续沿现有北极星收口实现；尤其避免再次滑回“桥更聪明、更多猜测、更多接管”的旧路径。

### `P0 / Action-Boundary Model` 收口原则

- 这一步的目标不是让 bridge 更聪明，而是让 bridge 更克制、更稳定、更可审计
- 北极星保持极简：用户真正交互的对象仍是 `Codex`；bridge 只做薄透传、边界守门、审批闭环、恢复与 repo-owned control-plane
- 本轮默认不追求额外扩张 bridge 能力面；优先做内部语义收敛，尽量保持外部行为稳定

#### Bridge Must Not

- 不许接管普通任务语义；用户在“做什么、怎么做”上默认仍与 `Codex` 交互
- 不许把普通高风险批准后改成 `bridge action` 执行；批准后仍应创建新的 `Codex run`
- 不许扩大 `bridge action` 劫持面；只有 repo-owned typed control-plane 才能归 bridge，混合语义默认回落 `Codex`
- 不许把 discussion / doc 语义误判成真实执行，也不许因为“像讨论”就放松 `host_secret`、`isolation_boundary` 等硬边界
- 不许把 policy 对象化重构变成行为偷改；不允许靠“猜用户意思”来减少审核
- 不许让最终裁决不可解释；每个 `allow / approval / deny` 都必须能回溯到明确的内部对象

#### 最小内部对象

- 这里先显式拆开两种不同的 boundary 概念，避免再把它们混写：
- `execution boundaries`：决定某个执行请求是否越界、是否需要审批、是否应直接拒绝
- `routing boundaries`：决定一句自然语言是否仍是纯 repo-owned control-plane，还是应回落给 `Codex`
- 当前代码内部已拆为 `executionBoundaries` 与 `routingBoundaries`；本节文档与代码语义现已对齐

- `intent`：`read` / `write` / `discussion` / `bridge_control` / `unknown`
- `execution boundaries`：`inside_cwd` / `outside_cwd_write` / `host_codex` / `host_secret` / `protected_root` / `isolation_boundary`
- `effects`：`service_control` / `scheduler_control` / `process_control` / `remote_boundary` / `container_control` / `publication_boundary` / `global_env_change` / `destructive_change`
- `decision`：只保留 `kind` 与 `reasonCodes`，且只从 `intent + execution boundaries + effects` 推导，不再直接读取 prompt 表面语义作最终裁决

#### 固定裁决顺序

- 先看 `deny execution boundary`
- 再看 `approval execution boundary / effect`
- 最后才 `allow`
- `discussion` 只能用于减少误审，不能覆盖硬边界
- `bridge_control` 只能用于识别 repo-owned control-plane，不能形成旁路特权

#### 本轮验收口径

- `误放零新增`
- `误审允许净减少`
- 用户主观上仍主要是在和 `Codex` 交互；只有在审批、边界拒绝、恢复提示、repo-owned control-plane 这类必要时刻，bridge 才短暂浮出

#### 最小实施计划

##### Task 1：冻结外部行为，先补对象化护栏

- **Files**
- 修改：`extensions/codex-bridge/test/policy.test.js`
- 修改：`extensions/codex-bridge/test/routing.test.js`
- 修改：`extensions/codex-bridge/lib/policy.js`
- **目标**
- 先把 `deny > approval > allow`、`discussion 不能覆盖硬边界`、`bridge_control 不能扩大劫持面` 这几条变成更直接的回归测试
- 在不改变对外 API 的前提下，为后续内部对象化重构锁住行为边界
- **执行步骤**
- 写新增红测：覆盖 `discussion` 遇到 `host_secret / isolation_boundary` 仍拒绝、`bridge_control` 遇到混合语义仍回落 `Codex`
- 运行：`node --test extensions/codex-bridge/test/policy.test.js extensions/codex-bridge/test/routing.test.js`
- 最小补测试缺口，不在这一 task 里改决策模型

##### Task 2：把现有 signals 收敛成最小内部对象

- **Files**
- 修改：`extensions/codex-bridge/lib/policy.js`
- 修改：`extensions/codex-bridge/test/policy.test.js`
- **目标**
- 把当前 `action / intentSignals / pathSignals / executionSignals` 收敛成稳定的内部对象：`intent`、`execution boundaries`、`effects`、`decision`
- 保留现有 regex/path helper 作为信号源，不在这一步重写识别引擎
- **执行步骤**
- 先写一组红测：验证对象化后仍保持 `assessPolicyDecision(...)` 现有公开行为不变
- 在 `policy.js` 内新增最小归一层：
- `intent`: `read | write | discussion | bridge_control | unknown`
- `execution boundaries`: `inside_cwd | outside_cwd_write | host_codex | host_secret | protected_root | isolation_boundary`
- `effects`: `service_control | scheduler_control | process_control | remote_boundary | container_control | publication_boundary | global_env_change | destructive_change`
- 让 `assessPolicyDecision(...)` 改为只消费对象，不再直接拼 prompt/path/execution 细节
- 运行：`node --test extensions/codex-bridge/test/policy.test.js`

##### Task 3：固定统一裁决器，防止对象化后扩权

- **Files**
- 修改：`extensions/codex-bridge/lib/policy.js`
- 修改：`extensions/codex-bridge/test/policy.test.js`
- 修改：`extensions/codex-bridge/test/routing.test.js`
- **目标**
- 把最终裁决严格固定成：先 `deny execution boundary`，再 `approval execution boundary/effect`，最后 `allow`
- 明确 `discussion` 只负责减少误审、`bridge_control` 只负责 repo-owned control-plane 候选识别，二者都不能成为旁路特权
- **执行步骤**
- 写红测：直接覆盖 deny 优先级、approval 聚合、discussion 不覆盖硬边界、bridge_control 不绕开混合语义回退
- 在 `policy.js` 中抽出纯裁决器，只接受已归一对象并产出 `kind + reasonCodes`
- 保持 `classifyOwnedBridgeActionRequest(...)` 现有对外结果稳定，但其内部判定与 policy 对象边界对齐
- 运行：`node --test extensions/codex-bridge/test/policy.test.js extensions/codex-bridge/test/routing.test.js`

##### Task 4：做整体验证，不把重构伪装成正确

- **Files**
- 修改：`extensions/codex-bridge/lib/policy.js`
- 修改：`extensions/codex-bridge/test/policy.test.js`
- 修改：`extensions/codex-bridge/test/routing.test.js`
- 只在必要时修改：`docs/roadmap.md`
- **目标**
- 用现有全量桥接测试证明：这轮是内部对象化收敛，不是行为偷改
- 对照本节验收口径，确认 `误放零新增`、`误审允许净减少`
- **执行步骤**
- 运行：`node --test extensions/codex-bridge/test/policy.test.js extensions/codex-bridge/test/routing.test.js extensions/codex-bridge/test/runtime-control-plane.test.js extensions/codex-bridge/test/runtime-compatibility.test.js`
- 运行：`node --test extensions/codex-bridge/test/*.test.js`

##### 当前落地状态（2026-03-26）

- `Task 2` 已基本落地：`assessPolicyDecision(...)` 已固定为 `intent / executionBoundaries / effects / decision` 内部对象后再统一裁决
- `Task 3` 已基本落地：`classifyOwnedBridgeActionRequest(...)` 对外结果保持稳定，但内部已收口为 `bridge_control` assessment，再由单一 `decision` 对外返回
- 这里的 boundary 已在代码层拆开：通用 policy 使用 `executionBoundaries`；bridge-control classification 使用 `routingBoundaries`
- 准入规则表：
- 三步判定顺序：
  - 第一步：先问是不是**纯 repo-owned control-plane**
  - 第二步：如果不是纯控制，或存在**歧义**
  - 第三步：或者一旦**混入普通工作语义**，就默认回落 `Codex`
- 术语对照：
  - “是不是纯 repo-owned control-plane” ↔ `intent` / `effects`，见 `extensions/codex-bridge/lib/policy.js:107`、`extensions/codex-bridge/lib/policy.js:115`
  - “是否存在歧义 / 是否混合语义” ↔ `routing boundaries`，见 `extensions/codex-bridge/lib/policy.js:124`
  - “最终归 bridge 还是回落 Codex” ↔ `decision`，见 `extensions/codex-bridge/lib/policy.js:133`
  - 通用 policy 同样遵循 `intent -> execution boundaries -> effects -> decision`，见 `extensions/codex-bridge/lib/policy.js:323`、`extensions/codex-bridge/lib/policy.js:363`、`extensions/codex-bridge/lib/policy.js:401`、`extensions/codex-bridge/lib/policy.js:417`

| 类别 | 示例短语 | 期望归属 | 规则解释 | 第一原则原因 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 纯控制 / service | `what is the status of <owned-service>` | bridge-owned | 纯 repo-owned service `status` | bridge 只接 repo-owned control-plane，不替用户扩展普通任务语义 | `extensions/codex-bridge/test/routing.test.js:112` |
| 纯控制 / gateway health | `can you check the health of gateway` | bridge-owned | 纯 gateway health 查询 | 只读 control-plane 可由 bridge 薄处理，用户仍主要在和 `Codex` 交互 | `extensions/codex-bridge/test/routing.test.js:128` |
| 纯控制 / gateway health | `show gateway health details` | bridge-owned | 纯 gateway health 详情查询 | 仍属 repo-owned control-plane，只扩等价表达，不扩能力面 | `extensions/codex-bridge/test/routing.test.js:144` |
| 纯控制 / diagnostic | `please check bridge diagnostic info` | bridge-owned | 纯 bridge diagnostic 信息查询 | 只读 diagnostic 属 bridge 自有控制面，不会形成旁路特权 | `extensions/codex-bridge/test/routing.test.js:160` |
| 纯控制 / diagnostic | `show me bridge diagnostic details` | bridge-owned | 纯 bridge diagnostic 详情查询 | 只补等价短语，保持外部行为收口而非变聪明 | `extensions/codex-bridge/test/routing.test.js:176` |
| 纯控制 / diagnostic | `show diagnostic details of bridge` | bridge-owned | 纯 bridge diagnostic 倒装表达 | 倒装表达仍是纯 control-plane，请求本质不变 | `extensions/codex-bridge/test/routing.test.js:192` |
| 纯控制 / install | `can you install the systemd service` | bridge-owned | 纯 repo-owned install lifecycle | 仅 repo-owned install lifecycle 属 bridge，自带审批闭环 | `extensions/codex-bridge/test/routing.test.js:232` |
| 歧义短语 | `status info of bridge|gateway|runner` | Codex-owned | bridge 不猜测归类，统一回落 | 宁可少审一点也不让桥替用户做主；有歧义就回 `Codex` | `extensions/codex-bridge/test/routing.test.js:208` |
| 混合语义 | `重启 <owned-service> 并总结 README.md` | Codex-owned | control-plane + normal work 混合，回落 `Codex` | bridge 不能接管普通工作语义；混合请求默认交还 `Codex` | `extensions/codex-bridge/test/routing.test.js:102` |
| 混合语义 | `show me bridge diagnostic details and summarize README.md` | Codex-owned | diagnostic + normal work 混合，回落 `Codex` | 一旦掺入普通工作内容，就不能让 bridge 劫持整条请求 | `extensions/codex-bridge/test/routing.test.js:248` |
| 混合语义 | `show diagnostic details of bridge and summarize README.md` | Codex-owned | diagnostic 倒装 + normal work 混合，回落 `Codex` | 倒装不改变本质：混合语义仍应回到 `Codex` | `extensions/codex-bridge/test/routing.test.js:258` |
| 混合语义 | `show gateway health details and summarize README.md` | Codex-owned | gateway health + normal work 混合，回落 `Codex` | 普通工作一旦出现，bridge 只能让位，避免扩大劫持面 | `extensions/codex-bridge/test/routing.test.js:268` |

- 已补的防扩权护栏包括：混合语义仍回落 `Codex`，`discussion` 仍不覆盖 `host_secret / isolation_boundary` 硬边界
- 当前剩余工作重点不是扩能力面，而是继续做等价短语审计与收口，确认 bridge 只接纯 control-plane、不过度劫持普通任务
- 若有失败，先判断是对象层、边界层还是裁决层回退，不允许靠新增 prompt 特判糊过去

#### 下一步最小实施计划：Bridge 误劫持防漂移护栏

**Goal:** 继续收紧 `classifyOwnedBridgeActionRequest(...)` 的接管门槛，优先防止 bridge 误劫持普通任务，而不是扩更多 control-plane 表达。

**Architecture:** 保持现有 `bridge_control -> routingBoundaries -> decision` 结构不变，先用负向回归测试锁住“哪些句子绝不能被 bridge 接管”，再做最小实现收口。外部行为目标是“宁可少接，不误接”；不扩 `bridge action` 能力面，不改 task continuity，不改审批对象模型。

**Tech Stack:** Node.js 内置测试框架、`extensions/codex-bridge/lib/policy.js`、`extensions/codex-bridge/test/routing.test.js`、`extensions/codex-bridge/test/runtime-control-plane.test.js`

### Task 1: 补反误劫持红测

**Files:**
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/runtime-control-plane.test.js`
- Check: `extensions/codex-bridge/lib/policy.js`

- [ ] **Step 1: 写失败用例，优先补负向 case**

补三类最小红测：

```js
test("protocol/input/bridge_action: owned service status plus ordinary repo work falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "what is the status of openclaw-codex-feishu.service and summarize README.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});
```

```js
test("protocol/input/bridge_action: gateway health plus ordinary repo work falls back to codex", () => {
  assert.equal(
    classifyOwnedBridgeActionRequest({
      prompt: "check gateway health and review docs/feishu-codex-runner-v1.md",
      bridgeServiceUnitNames: ["openclaw-codex-feishu.service"],
    }),
    null,
  );
});
```

```js
test("runtime/control-plane/routing: mixed bridge control and ordinary work does not create a bridge action", async () => {
  // routeInbound("check gateway health and summarize README.md") 应继续走 codex task 路径
});
```

- [ ] **Step 2: 运行红测，确认失败点在误劫持护栏**

Run: `node --test extensions/codex-bridge/test/routing.test.js extensions/codex-bridge/test/runtime-control-plane.test.js`

Expected: 新增 case 先失败，且失败原因是 `classifyOwnedBridgeActionRequest(...)` 仍把混合语义认成 bridge-owned。

- [ ] **Step 3: 做最小实现，不补能力面**

只在 `extensions/codex-bridge/lib/policy.js` 收紧 `createBridgeControlRoutingBoundaryAssessment(...)` 或其上游输入，目标是把“纯 control-plane”判定做得更窄，而不是新增可接管短语。例如：

```js
function createBridgeControlRoutingBoundaryAssessment({ intent, effects, prompt }) {
  const matchedEffects = Object.values(effects).filter(Boolean);
  return {
    dedicatedRequest: matchedEffects.length === 1,
    ambiguousIntent: matchedEffects.length > 1,
    mixedIntent:
      intent === "bridge_control" &&
      (matchedEffects.length === 0 || hasOrdinaryWorkResidue(prompt)),
  };
}
```

要求：

- 不新增新的 bridge-owned kind
- 不扩大现有 service / gateway / diagnostic / install 生命周期表达面
- 只增加“不得接管”的判定

- [ ] **Step 4: 运行绿测，确认现有纯控制面能力未回退**

Run: `node --test extensions/codex-bridge/test/routing.test.js extensions/codex-bridge/test/runtime-control-plane.test.js`

Expected: 既有纯 control-plane 用例继续通过；新增混合语义 case 转绿。

### Task 2: 做一轮防漂移回归

**Files:**
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Check: `docs/product-decision-baseline.md`
- Check: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: 再补一组“未来容易漂移”的负向 case**

优先补这种结构，而不是补更多正向短语：

```js
"show bridge diagnostic details and explain README structure"
"install the systemd service and then update docs/roadmap.md"
"status of openclaw-codex-feishu.service, then fix the failing test"
```

这些都应回落 `Codex`。

- [ ] **Step 2: 运行定向测试**

Run: `node --test extensions/codex-bridge/test/routing.test.js`

Expected: 所有新负向 case 通过；没有为了防劫持而破坏既有明确 bridge-owned case。

- [ ] **Step 3: 跑全量 bridge 回归**

Run: `node --test extensions/codex-bridge/test/*.test.js`

Expected: 全量通过；若失败，优先回退实现，不靠新增 prompt 特判补洞。

## 决策提醒

- 用户价值北极星是协作体验
- 建设优先级底座是安全执行核心与任务状态机
- 渠道能力再强，也不能反向定义执行语义
