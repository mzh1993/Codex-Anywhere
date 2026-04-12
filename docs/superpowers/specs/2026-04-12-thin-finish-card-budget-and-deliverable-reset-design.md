# Thin Finish-Card Budget And Deliverable Reset Design

日期：2026-04-12

状态：设计已确认，待实现计划

## 背景

最近真实使用里暴露了两个体验问题：

1. 完成卡在带有较长 `summary` 时，尾部的 `下一步` 体感上会偶发缺失或不稳定显示。
2. 长对话持续推进时，上一轮明确要求回传过的产物（尤其是 `.md`）有时会在后续未再次要求的轮次里继续自动回传。

这两个问题都发生在 reply plane / finish-card 这一层，但约束仍然不变：

- bridge 必须保持薄
- bridge 不能获得内容裁决权
- bridge 只能做 transport-safe / presentation-safe 的最薄处理

## 问题拆解

### 问题 1：完成卡内容预算不稳定

当前完成卡会直接拼接：

- 任务头
- `cwd`
- `sessionId`
- `summary`
- `deliveryFailureHint`
- `changedFiles`
- `nextSteps`

虽然 bridge 已经在 reply-plane 场景下抑制了一部分 `changedFiles`，但整体仍没有统一的“完成卡预算”约束。结果是：

- 卡片最终长度依赖 `summary` 实际文本
- `nextSteps` 排在较后位置
- 一旦平台端对 markdown/card 渲染存在长度或显示预算，尾部信息会显得不稳定

这里的问题不是 bridge 没解析出 `nextSteps`，而是完成卡没有做 presentation-safe 的稳定整形。

### 问题 2：deliverables 跨轮次粘连

当前新 run 启动时会清空：

- `summary`
- `changedFiles`
- `nextSteps`

但没有显式清空：

- `deliverables`
- `deliveryFailureHint`

因此，上一轮已经持久化到 task 上的 reply-plane 交付状态，可能被后续轮次继续沿用，表现为：

- 用户上一轮要过 `.md`
- 后一轮没再要
- bridge 仍可能沿用上一轮交付状态，造成“旧产物继续自动回传”的错觉或真实误回传

这不是策略问题，而是 run 初始化时状态清理不完整。

## 设计目标

这次修正只解决两个问题：

1. 新 run 必须与上一轮 deliverable 状态隔离
2. 完成卡必须稳定保住 `summary`，同时保住最小 `next step` 可见性

明确不做：

- 不让 bridge 重新总结或改写 `summary`
- 不让 bridge 判断哪条 `next step` 更重要
- 不让 bridge 推断哪些产物应该继续回传
- 不新增任何 reply-plane 命令面

## 方案对比

### 方案 A：固定预算模板（推荐）

做法：

- 新 run 启动时显式清空 `deliverables` 和 `deliveryFailureHint`
- 完成卡采用固定展示顺序：
  1. 任务头
  2. `summary`
  3. `deliveryFailureHint`
  4. `nextSteps`（最多 1 条）
- `summary` 只做机械截断
- `nextSteps` 只做数量上限，不做语义筛选

优点：

- 保住 `summary`
- 保住最小行动性
- 仍是固定模板整形，不是内容裁决

缺点：

- 长摘要会被截短
- 只能默认保留 1 条 `next step`

### 方案 B：只保 `summary`

做法：

- 修 deliverable 粘连
- 完成卡只保留任务头和 `summary`

优点：

- 最薄

缺点：

- “下一步”会继续在主路径缺席

### 方案 C：完成卡 + 额外下一步消息

做法：

- 修 deliverable 粘连
- 完成卡只保 `summary`
- 额外再发一条“下一步”消息

优点：

- 信息完整

缺点：

- 更吵
- 增强了 bridge 的会话存在感
- 明显偏离“最薄呈现整形”

## 决策

采用 **方案 A：固定预算模板**。

原因：

- 它同时解决两个真实体验问题
- 它只引入固定模板预算，不引入 bridge 内容理解
- 它与现有 `.svg -> file`、markdown 图片去除一样，都属于 presentation-safe 级别，而不是语义增强

## 详细设计

### 一、run 启动时强制清空 reply-plane 状态

在新 run 创建对应的 task/run 持久化对象时，显式重置：

- `deliverables = []`
- `deliveryFailureHint = null`

语义：

- deliverable 声明永远只属于“当前这一轮完成结果”
- 不能跨 run 继承
- 同一 task lane 可以连续，但 reply-plane 交付状态必须按 run 切分

### 二、完成卡引入固定预算模板

完成卡仍使用现有 `taskFinished` 出口，但输出规则改为：

1. 任务状态头（保留）
2. 工作目录 / session 信息（保留）
3. `summary`（保留，允许机械截断）
4. `deliveryFailureHint`（若有则保留）
5. `nextSteps` 最多 1 条
6. 其余不进入完成卡

额外约束：

- reply-plane 有原生产物回传时，不展示 `changedFiles`
- 不新增第二条“下一步”提示消息
- 不重写 `summary`
- 不根据语义判断哪条 `next step` 更重要，只保留顺序上的第 1 条

### 三、预算规则必须是机械的

允许的 bridge 行为：

- 固定字段顺序
- 固定长度上限
- 固定数量上限

不允许的 bridge 行为：

- 压缩改写 `summary`
- 总结 `nextSteps`
- 判断“主次重点”
- 根据用户历史意图推断是否应该继续交付旧产物

## 测试与契约

这次实现应补上三类验证：

### 1. 状态隔离测试

- 旧 run 已有 `deliverables`
- 新 run 启动后 task/run 上的 `deliverables` 必须为空
- 后续回传只允许来自新 run 的 manifest

### 2. 完成卡预算测试

- 很长 `summary` + 多条 `nextSteps`
- 完成卡应保留：
  - `summary`
  - 最多 1 条 `next step`
- 不再依赖平台截断来决定尾部是否可见

### 3. 契约矩阵更新

需要把这次变化定义为：

- reply-plane run-scoped delivery state
- finish-card presentation budget / stability

并明确写成 presentation / persistence 约束，而不是产品命令面或 bridge 语义扩张。

## 非目标

本次不做：

- 多产物优先级排序
- 附件类型更智能的回传选择
- 自动生成“适合飞书展示”的摘要
- 第二条补充卡片或补充消息
- 跨 origin 回传策略扩展

## 预期结果

落地后应达到：

- 用户这一轮没要求的旧 `.md` 不会再跨轮自动回传
- 完成卡始终优先保住 `summary`
- 完成卡仍保留最小行动性：至少 1 条 `next step`
- bridge 只是在做固定预算整形，而不是长出新的内容心智

一句话：

- **让回传状态按 run 隔离，让完成卡按固定预算稳定显示，同时不让 bridge 获得内容裁决权。**
