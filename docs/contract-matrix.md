# Contract Matrix

> Development-time governance only. This matrix constrains design/review/testing quality. It is not a runtime policy engine, does not add new bridge commands, and does not thicken ordinary-text semantics.

## Schema

Every contract row must use this shape:

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |

Field constraints:

- `visible_to_user`: `user-visible` | `internal-state` | `both`
- `platform`: `cross-platform` | `linux-only` | `windows-only` | `allowed-diff`
- `required_tests`: comma-separated families (for example `policy`, `routing`, `persistence`, `presentation`, `continuity`, `runtime_compat`)

## Matrix

### Product Boundary

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| PB-001 | product-north-star + v1:/codex 命令面 | Ordinary text remains Codex-owned; bridge must not claim ordinary text as bridge command semantics. | both | cross-platform | routing, runtime_compat | Proof: `runtime/protocol/plain_text:*`, `runtime/protocol/plain_text/protected_root_mentions:*` |
| PB-002 | v1:/codex 命令面 | Bridge gating only applies on explicit `/codex ...` entry or bridge-owned approval/control loops. | both | cross-platform | routing, runtime_control_plane, runtime_compat | Prevents bridge semantic takeover of general Codex conversation. |
| PB-003 | v1:/codex 命令面 | Closed legacy slash commands must stay closed and return native-first short hint only. | user-visible | cross-platform | routing, runtime_compat, command_fallback | Proof: `constitution/locale/unknown_command:*`, `runtime/protocol/command_surface/*` |

### Permission Boundary

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| PM-001 | v1:风控 + 最小策略矩阵 | Writes outside `cwd` require approval; reads outside `cwd` can remain allowed. | both | cross-platform | policy, runtime_compat | Proof: `approval/write/outside_cwd:*`, `allow/read/outside_cwd:*` |
| PM-002 | v1:风控 + 最小策略矩阵 | Protected roots (`~/.openclaw`, `~/.codex`) use thin pre-start approval gate on explicit native entry, not direct denial. | both | cross-platform | policy, runtime_compat | Proof: `runtime/protocol/native_entry/protected_root:*` |
| PM-003 | v1:运行模式配置 | `native_windows_fast` may intentionally bypass approval for explicit native full-access flags; this is an allowed platform difference. | both | allowed-diff | runtime_compat, codex_exec | Proof: `runtime/protocol/native_entry/permissions:*`, `runtime/exec/windows_fast:*` |

### Continuity

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| CT-001 | v1:执行模型 | On gateway interruption, task continuity remains on the same active task lane; next plain text continues that task. If `activeTaskId` is missing but `lastTaskId` still points to an active task, bridge auto-recovers the continuity lane. | both | cross-platform | persistence, continuity, runtime_compat | Proof: `runtime/protocol/restart:*`, `protocol/persistence/task: gateway-stop interruption preserves task continuity`, `runtime/protocol/continuity: missing activeTaskId auto-recovers from lastTaskId and keeps the same task lane` |
| CT-002 | v1:执行模型 | `before_reset` must clear bridge continuity lane; next plain text starts fresh lane. | both | cross-platform | runtime_compat | Proof: `runtime/protocol/reset:*` |
| CT-003 | v1:执行模型 | Approval completion starts a new run on the same task; it must not resume the blocked run. | both | cross-platform | routing, task_model, runtime_compat | Proof: `protocol/transition/approval:*`, `runtime/protocol/approval:*` |

### Observability

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| OB-001 | v1:执行模型 + 状态协议 | Long-running execution must keep one progress card and refresh within bounded silence (no 30s card spam). | both | cross-platform | persistence, presentation, runtime_compat | Proof: `runtime/persistence/heartbeat:*`, `runtime/protocol/presentation:*`; known stderr router noise should not overwrite the last visible status hint (`runtime/persistence/progress: router stderr noise does not overwrite the last visible status hint`). |
| OB-002 | v1:执行模型 | A new run on an existing task must create a fresh progress card anchored to the latest inbound message. | both | cross-platform | runtime_compat, presentation | Proof: `runtime/protocol/presentation: a new run on an existing task starts a fresh progress card on the latest inbound message` |
| OB-003 | v1:状态协议 | Finish must update existing progress card instead of emitting duplicate lifecycle cards. | user-visible | cross-platform | runtime_compat, presentation | Proof: `runtime/protocol/presentation: finish updates the existing progress card instead of sending a second lifecycle card` |

### Command Surface

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| CS-001 | v1:/codex 命令面 | `/codex --cd <path> <prompt>` starts a normal task in target cwd, not a pure directory switch command. | both | cross-platform | runtime_compat | Proof: `runtime/protocol/native_entry/new: minimal prompt like entering directory still starts a normal codex task` |
| CS-002 | v1:/codex 命令面 | `/codex resume <prompt>` is explicit continue entry; missing prompt returns native usage and fail-closed. | both | cross-platform | routing, runtime_compat | Proof: `runtime/protocol/native_entry/resume:*`, `runtime/protocol/native_entry/usage:*` |
| CS-003 | v1:/codex 命令面 | `/codex doctor` must return concrete runtime readiness summary, not generic/noisy status fallback. | user-visible | cross-platform | runtime_compat, command_fallback | Proof: `runtime/protocol/command_surface/doctor:*`, `constitution/command_fallback/doctor:*` |

### Cross-Platform Semantics

| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
| --- | --- | --- | --- | --- | --- | --- |
| XP-001 | v1:运行模式配置 + 执行模型 | Task continuity and restart-recovery contract must hold in both `secure_linux` and `native_windows_fast`. | both | cross-platform | runtime_compat, persistence | Proof: `runtime/protocol/restart:*` includes windows-fast variants. |
| XP-002 | v1:运行模式配置 | Runtime preflight/compat checks are strict in Linux mode and intentionally bypass bwrap checks in `native_windows_fast`. | both | allowed-diff | runtime_compat, runtime_contract | Difference is allowed but must remain explicit and tested. |
| XP-003 | v1:/codex 命令面 | Windows path parsing for explicit native start preserves backslashes and quoted-space paths. | user-visible | windows-only | runtime_compat | Proof: `runtime/protocol/native_entry/new: unquoted Windows cwd keeps backslashes intact`, `...quoted Windows cwd with spaces...` |

## Review Gate (Lightweight)

- If behavior meaning changes in product boundary, permission boundary, continuity, observability, command surface, or cross-platform semantics, update this matrix in the same change.
- For risky rows, proof should cover both user-visible behavior and internal-state correctness where applicable.
- This gate is review-time only; do not implement runtime contract evaluation in bridge code.
