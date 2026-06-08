# Experience Regression Checklist

> 目标：把用户可感知体验问题固定成每轮可执行的回归条目，优先覆盖连续性、审批、重启恢复、长任务观测。

## 一键入口

```bash
scripts/review/run-experience-regression.sh
```

> 可选全量（包含全测试集，带超时防挂尾）：`RUN_FULL=1 scripts/review/run-experience-regression.sh`

## A. 连续任务（Continuity）

- [ ] 主路径是直接回复：`awaiting_input` 下回复普通文本，仍续到同一 `taskId` 的下一轮 run，不要求先敲 `/resume`。
- [ ] 配对 DM 里“帮我看这张图”并附图片时，bridge 不额外发控制面提示；Codex 在同一 task lane 启动，并能拿到图片上下文。若图片下载失败，文本仍继续进入同一 task lane。
- [ ] `/resume <prompt>` 只是兜底续写：显式 resume 进入同一任务下一轮 run，不新建 lane，也不在文案里冒充主路径。
- [ ] 非 `awaiting_input` 状态不误续写：任务仍在 `running` 时，普通文本不会被伪装成 resume 或偷偷塞进旧 run。
- [ ] 新 run 不继承上一轮 reply-plane `deliverables` / `deliveryFailureHint`。
- [ ] `activeTaskId` 漂移自愈：仅有 `lastTaskId` 时可自动恢复 continuity lane。
- [ ] 显式 `/run --cd ...` 新任务能正确 supersede 旧 `awaiting_input` 任务。

契约映射：`CT-001` `CT-003` `CT-004` `CS-002`

建议核对测试：`extensions/codex-bridge/test/routing.test.js` 中 `protocol/input/awaiting_input`、`protocol/resume_gate`、`protocol/locale/status`、`protocol/locale/recovery`

## B. 审批闭环（Approval）

- [ ] 高风险请求进入审批，卡片按钮/自然语言审批都可完成闭环。
- [ ] “同意，并 …”仅在边界不扩张时消费审批；超边界保持审批挂起，不把补充文本误当 continuation prompt。
- [ ] 审批完成后是同一任务的新 run，不是恢复被阻塞的旧 run。
- [ ] 拒绝后回到可重规划状态，不吞 token，不误启动 run。

契约映射：`PM-001` `PM-002` `CT-003` `CS-002`

建议核对测试：`extensions/codex-bridge/test/routing.test.js` 中 `protocol/transition/approval` 相关用例；`extensions/codex-bridge/test/runtime-control-plane.test.js`

## C. 重启恢复（Restart Recovery）

- [ ] gateway/bridge 重启后，下一条普通文本默认续同一任务，不要求用户改走 `/codex resume`。
- [ ] 中断/恢复提示文案是 continuity-friendly：先教“直接回复下一步给 Codex”，再把 `/codex resume <prompt>` 作为兜底提示。
- [ ] reset 信号清 lane 后，下一条普通文本会起新 lane，不串旧尾巴。

契约映射：`CT-001` `CT-002` `CS-002`

建议核对测试：`extensions/codex-bridge/test/routing.test.js` 中 `protocol/locale/recovery`；`extensions/codex-bridge/test/persistence-reliability.test.js`；`extensions/codex-bridge/test/runtime-compatibility.test.js`

## D. 长任务可观测性（Observability）

- [ ] 同一任务始终同卡更新，不出现“开新进度卡漂移”。
- [ ] 同一任务的新 run 会锚到最新入站消息，开启新的进度卡；旧卡不被错误复用到新一轮用户输入上。
- [ ] `task_progress` / `task_running` 样式一致（标题与模板一致）。
- [ ] 重复同提示不刷屏（去重生效）。
- [ ] 心跳文案紧凑且提示长度有上限，降低文本长度抖动。
- [ ] 已知 router 噪声 stderr 不污染“最近状态”。
- [ ] 完成卡长摘要下仍保留 `summary` 且仅保留 1 条 `next step`。
- [ ] finish/result 文案使用 run-level 语义：例如“本轮执行已完成 / Codex run failed”，不要写成 lane 终止或“Codex 任务已完成”。
- [ ] `awaiting_input` 的 finish 卡保留 continuity 信号：run 已结束，但任务状态仍明确展示为 `等待输入` / `awaiting_input`。

契约映射：`OB-001` `OB-002` `OB-003` `OB-004` `OB-005`

建议核对测试：`extensions/codex-bridge/test/routing.test.js` 中 `protocol/locale/finish`、`protocol/locale/status`；`extensions/codex-bridge/test/runtime-contract.test.js`

## E. 部署契约（Deployment）

- [ ] Linux bootstrap 默认路径不绑定作者机器：默认 `cwd` 与 `~/.codex` 路径来自当前用户家目录。
- [ ] Windows `-BasePort` 会真实进入生成的 launcher，不会悄悄回落到硬编码端口。
- [ ] repo-local 识别/运维辅助脚本保持当前 `/codex` 命令面，不夹带旧命令或 app-specific 指纹。
- [ ] Linux `--no-systemd` 安装会把 `install-health.json` 写成前台人工启动语义，而不是含糊的 service unknown。

契约映射：`XP-005` `XP-006` `XP-007` `XP-008`

## 自动回归命令（当前固定）

- `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
- `node --test extensions/codex-bridge/test/presentation-copy-matrix.test.js`
- `node --test extensions/codex-bridge/test/persistence-reliability.test.js`
- `node --test extensions/codex-bridge/test/runtime-contract.test.js`
- `scripts/review/check-contract-matrix.sh origin/main...HEAD`

## 结果记录模板

- 结论：通过 / 不通过
- 失败条目：
  - 条目编号：
  - 现象：
  - 期望：
  - 关联契约：
  - 关联测试：
