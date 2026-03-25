# Bridge Action Gray Acceptance Matrix

- Date: 2026-03-25
- Stage: pre-implementation gate

## Goal

Provide a release gate for the bridge-action runtime change before code is written.

This matrix exists to stop three common failure modes:

- bridge starts stealing inputs that still belong to Codex
- bridge-owned control-plane actions pollute Codex task continuity
- new runtime behavior passes unit tests but still feels noisy or confusing in real DM use

## Global Acceptance Rules

Every scenario below must satisfy these global rules:

1. 渠道不决定执行语义。
2. Natural language stays the main path.
3. Bridge commands remain fallback-only.
4. Repository-owned control-plane actions stay narrow and explicit.
5. `bridge action` never overwrites `codex task` continuity.
6. Bridge user-facing output stays shorter than Codex task output.

## User-Visible Invariants

- Users should mainly feel they are talking to remote Codex.
- Bridge should surface only for approval, boundary refusal, recovery, or repository-owned control-plane execution.
- If the bridge does not clearly own the semantics, it must not hijack the turn.
- If a bridge action completes, the next normal work message should still continue the previous Codex task when applicable.

## Priority Levels

- `P0`: must pass before any gray rollout
- `P1`: should pass before wider internal use
- `P2`: can follow after first gray rollout, but should already be tracked

## Scenario Matrix

| ID | Priority | Pre-state | User input | Expected owner | Expected result |
| --- | --- | --- | --- | --- | --- |
| `GA-001` | `P0` | `no_task` | `帮我总结 README 开头` | `codex task` | 创建普通 Codex task；bridge 不额外插话。 |
| `GA-002` | `P0` | `awaiting_input` with active Codex task | `继续，把二级标题整理成一行` | `codex task` | 继续原 task；不要求 `/codex continue`。 |
| `GA-003` | `P0` | `no_task` | `请重启 openclaw-codex-feishu.service` | `bridge action` | 创建 bridge-owned control-plane action，而不是新 Codex task。 |
| `GA-004` | `P0` | active Codex task in `awaiting_input` | `请重启 openclaw-codex-feishu.service` | `bridge action` | 执行独立 bridge action；原 Codex task 保持原 continuity，不被覆盖。 |
| `GA-005` | `P0` | bridge action `awaiting_approval` | `为什么要审批？` | `bridge` | 保持审批态，只做一次短解释，不推进执行。 |
| `GA-006` | `P0` | bridge action `awaiting_approval` | `同意` | `bridge` | bridge 直接执行已拥有的控制面动作；不把批准再透传给 Codex。 |
| `GA-007` | `P0` | bridge action `awaiting_approval` | `不要执行` | `bridge` | 安全结束本次 bridge action；不终止原 Codex task。 |
| `GA-008` | `P0` | bridge action just finished; prior Codex task still `awaiting_input` | `继续刚才那个任务` | `codex task` | 回到原 Codex task continuity；bridge action 不残留为主上下文。 |
| `GA-009` | `P0` | `no_task` | `请重启 nginx` | `codex task` or existing task-policy path | bridge 不把它误判成 repository-owned control-plane action。 |
| `GA-010` | `P0` | `no_task` | `请 docker restart xxx` | `codex task` or existing task-policy path | bridge 不越权变成通用运维面板。 |
| `GA-011` | `P0` | bridge action `awaiting_approval` | `你看着办` | `bridge` | 不授权；保持 gate open；回复短澄清或短解释。 |
| `GA-012` | `P0` | bridge action `awaiting_approval` | `1` | `bridge` | 若当前未明确给编号选项，则不视为授权。 |
| `GA-013` | `P1` | active Codex task `running` | `请重启 openclaw-codex-feishu.service` | product decision required | 明确定义是否允许并行 bridge action；若暂不支持，必须短拒绝且不污染 task。 |
| `GA-014` | `P1` | active Codex task `awaiting_approval` | `同意` | `bridge approval` | 仍按原 task 审批语义处理，不能被新的 bridge-action lane 打坏。 |
| `GA-015` | `P1` | bridge self-restart recovery after owned control-plane action | `继续` / 自然语言继续 | `codex task` | 恢复提示简短；若原任务仍可继续，应自然语言继续而非强制命令。 |
| `GA-016` | `P1` | status query during bridge action | `/codex status` | fallback control | 状态可查，但不把 bridge 内部对象过度暴露给普通用户。 |
| `GA-017` | `P2` | bridge action completion | result reply | `bridge` | 完成文案只有最小结果，不出现 task summary / changed files / next steps 模板。 |
| `GA-018` | `P2` | repeated ambiguous inputs in bridge approval | `嗯嗯` / `好像不行` | `bridge` | 不误批、不误拒、不丢 gate；阅读负担保持低。 |

## Open Decisions Before Implementation

- `OD-001`: 当活跃 `codex task` 处于 `running` 时，V1 是否允许并行 `bridge action`。默认建议：**不允许并行**，短拒绝并保持 task 不变，直到有明确产品决定。
- `OD-002`: `bridge action` 是否支持 `同意，并……` 这类 approval tail。默认建议：**V1 不支持**，只接受纯批准；带尾巴时短澄清，避免把 bridge action 又变回任务代理。
- `OD-003`: `/codex status` 是否需要显示 bridge-action 详情。默认建议：**只显示最小必要信息**，避免 bridge 内部对象重新外溢成阅读负担。

## Required Persistence Assertions

For every `P0` scenario involving `bridge action`, verify:

- no Codex task summary is overwritten
- no Codex task `cwd` is changed
- no Codex task `sessionId` is consumed by the bridge action
- bridge-action records are stored outside task/run persistence objects
- approval records for bridge actions do not masquerade as task-run transitions

## Required Automated Coverage

Before gray rollout, at minimum add:

- model tests for bridge-action statuses and transitions
- store tests for continuity separation
- routing tests for owned vs non-owned control-plane requests
- runtime tests for approval, deny, explain, execute, and return-to-task
- compatibility tests proving existing task approval flow still works

## Required Manual Gray Checks

Run these manually after automated tests pass:

1. Create a normal Codex task and continue it once.
2. Trigger a repository-owned bridge action from the same DM.
3. Deny it once.
4. Trigger it again and approve it.
5. Confirm the next normal message still resumes the original Codex task.
6. Trigger a non-owned host operation like `请重启 nginx` and confirm bridge does not hijack it.

## Failure Classification

- `owner_error`: bridge stole or lost ownership incorrectly
- `continuity_error`: bridge action polluted Codex task continuity
- `boundary_error`: bridge owned too much or too little
- `approval_error`: approve/deny/explain semantics were wrong
- `ux_noise`: reply was technically correct but too noisy
- `recovery_error`: interruption or restart broke the expected return path

## Release Gate

The bridge-action runtime change is not ready for gray rollout until:

- every `P0` scenario passes
- no `owner_error` or `continuity_error` remains open
- at least one real DM walkthrough confirms that the bridge feels less visible, not more visible
