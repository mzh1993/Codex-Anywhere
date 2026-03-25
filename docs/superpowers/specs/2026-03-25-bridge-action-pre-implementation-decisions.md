# Bridge Action Pre-Implementation Decisions

- Date: 2026-03-25
- Stage: approved pre-implementation rulings

## Goal

Freeze the remaining product decisions before runtime implementation starts, so the team does not re-decide core interaction semantics while writing code.

## Decision 1: No parallel `bridge action` while a `codex task` is `running`

### Ruling

V1 does **not** allow a new `bridge action` to start while the active `codex task` is in `running`.

### Why

- It avoids two concurrent owners fighting in one DM.
- It keeps V1 state semantics simple.
- It prevents bridge visibility from expanding during the most fragile runtime state.

### Required behavior

- If the user requests a repository-owned control-plane action while a task is `running`, bridge gives one short refusal.
- The active task remains unchanged.
- No new `bridge action` record is created.

## Decision 2: `bridge action` does not support approval tail in V1

### Ruling

V1 only accepts pure approval for `bridge action`.

`同意，并……` does **not** become a supported bridge-action mutation path in V1.

### Why

- Approval tail is natural for `codex task`, but dangerous for a narrow bridge-owned control plane.
- Supporting tail too early would blur the boundary between “approve a fixed owned action” and “ask bridge to improvise a task”.
- V1 should optimize for narrow ownership, not flexibility.

### Required behavior

- `同意` executes the owned control-plane action.
- `同意，并……` triggers one short clarification or refusal.
- Bridge must not silently reinterpret the tail as a new task or extra shell instruction.

## Decision 3: `/codex status` shows only minimal bridge-action state

### Ruling

When a bridge action exists, `/codex status` may expose only the minimum information needed to keep the user oriented.

It must not dump bridge-internal ids, progress events, or multi-section summaries by default.

### Why

- Status is a fallback control, not the main product surface.
- The bridge must stay less visible than the task executor.
- Too much bridge detail recreates the exact reading burden we are trying to remove.

### Required behavior

- Show whether a bridge action is waiting for approval or has just finished if that matters for the next user move.
- Do not show internal execution stream details.
- Do not let bridge-action status overshadow an active Codex task.

## Decision 4: Bridge control-plane execution uses fixed owned handlers, not free-form shell composition

### Ruling

Repository-owned control-plane actions must execute through fixed bridge handlers with explicit argument construction.

V1 does **not** allow free-form shell composition for bridge-owned actions.

### Why

- This is the only way to keep “bridge owns the action” true in practice, not just in prose.
- It sharply limits accidental scope creep into generic host administration.
- It reduces the risk that bridge-action implementation becomes a second task executor.

### Required behavior

- Each owned action maps to a small explicit executor path.
- Service control is limited to repository-owned units only.
- Bridge-owned diagnostics are read-only unless explicitly approved as lifecycle actions.

## Decision 5: `bridge action` persistence is independent from task/run persistence

### Ruling

`bridge action` records must live in their own persistence subtree and must not be encoded as task/run variants.

### Why

- `bridge action` is not a task and should not wear task clothing.
- Mixed persistence would corrupt continuity semantics and make recovery ambiguous.
- Separate storage keeps rollback, recovery, and audit easier to reason about.

### Required behavior

- No `bridge action` writes into task summary / next steps / changed files.
- No `bridge action` uses `currentRunId` or `lastRunId` as its primary identity.
- Recovery logic for tasks and bridge actions stays explicitly separate.

## Decision 6: Mixed-intent messages are resolved by boundary-first routing

### Ruling

If one message mixes a repository-owned control-plane request with normal Codex work, bridge resolves ownership boundary first instead of trying to satisfy both in one shot.

### Why

- A single message does not justify collapsing two product objects into one execution path.
- V1 should prefer explicitness over clever multi-intent orchestration.
- This keeps the bridge invisible by keeping it narrow.

### Required behavior

- If the control-plane action is clearly owned by bridge, bridge handles only that owned action.
- The user can then continue the Codex task in the next turn.
- Bridge must not bundle control-plane execution and normal task continuation into one implicit compound action in V1.

## Final Gate

Implementation should not start unless the runtime plan, the gray acceptance matrix, and these rulings all agree:

- `docs/superpowers/plans/2026-03-25-bridge-action-runtime-integration-implementation.md`
- `docs/superpowers/specs/2026-03-25-bridge-action-gray-acceptance-matrix.md`
- `docs/superpowers/specs/2026-03-25-bridge-action-pre-implementation-decisions.md`
