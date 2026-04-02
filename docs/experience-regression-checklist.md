# Experience Regression Checklist

> 目标：把用户可感知体验问题固定成每轮可执行的回归条目，优先覆盖连续性、审批、重启恢复、长任务观测。

## 一键入口

```bash
scripts/review/run-experience-regression.sh
```

> 可选全量（包含全测试集，带超时防挂尾）：`RUN_FULL=1 scripts/review/run-experience-regression.sh`

## A. 连续任务（Continuity）

- [ ] 普通文本续写不换任务 lane：`awaiting_input` 下回复普通文本仍续到同一 `taskId`。
- [ ] 显式 `/codex resume` 不新建任务：续写进入同一任务下一轮 run。
- [ ] `activeTaskId` 漂移自愈：仅有 `lastTaskId` 时可自动恢复 continuity lane。
- [ ] 显式 `/codex --cd ...` 新任务能正确 supersede 旧 `awaiting_input` 任务。

契约映射：`CT-001` `CT-003`

## B. 审批闭环（Approval）

- [ ] 高风险请求进入审批，卡片按钮/自然语言审批都可完成闭环。
- [ ] “同意，并 …”仅在边界不扩张时消费审批；超边界保持审批挂起。
- [ ] 拒绝后回到可重规划状态，不吞 token，不误启动 run。

契约映射：`PM-001` `PM-002` `CT-003` `CS-002`

## C. 重启恢复（Restart Recovery）

- [ ] gateway/bridge 重启后，下一条普通文本默认续同一任务。
- [ ] reset 信号清 lane 后，下一条普通文本会起新 lane，不串旧尾巴。

契约映射：`CT-001` `CT-002`

## D. 长任务可观测性（Observability）

- [ ] 同一任务始终同卡更新，不出现“开新进度卡漂移”。
- [ ] `task_progress` / `task_running` 样式一致（标题与模板一致）。
- [ ] 重复同提示不刷屏（去重生效）。
- [ ] 心跳文案紧凑且提示长度有上限，降低文本长度抖动。
- [ ] 已知 router 噪声 stderr 不污染“最近状态”。

契约映射：`OB-001` `OB-002` `OB-003`

## 自动回归命令（当前固定）

- `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
- `node --test extensions/codex-bridge/test/persistence-reliability.test.js`
- `scripts/review/check-contract-matrix.sh origin/main...HEAD`

## 结果记录模板

- 结论：通过 / 不通过
- 失败条目：
  - 条目编号：
  - 现象：
  - 期望：
  - 关联契约：
  - 关联测试：
