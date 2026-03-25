# Execution Runtime Compatibility P0 Design

- Date: 2026-03-24
- Stage: proposed design

## Goal

Fix the P0 where the bridge accepts a normal task, starts a Codex run, and only then discovers that the host execution runtime is incompatible with the Codex CLI sandbox path.

## First Principle

The channel must not define execution semantics.

A task should either:

- start on a known-good execution core, or
- fail before task start with an explicit infrastructure error

It must not enter the user-visible running lifecycle when the execution core is known to be unavailable.

## Confirmed Root Cause

The current bridge starts `codex exec` normally, but the host machine has:

- `codex-cli 0.116.0`
- `bubblewrap 0.4.0`

This Bubblewrap version does not support `--argv0`, while the Codex CLI sandboxed shell path on this host attempts to use that option.

As a result:

- the bridge can still launch the Codex session
- the model can still emit progress and a final answer
- but any shell command requested through the Codex tool path fails with `bwrap: Unknown option --argv0`

This means the product is not truly executing user tasks reliably, even though the transport and session lifecycle appear healthy.

## Product Requirement

Execution-core compatibility must be treated as a hard prerequisite, not as a best-effort condition.

For any task start path, including:

- new normal task start
- approved high-risk task start
- explicit `/codex continue` start

if the host execution runtime is incompatible, the bridge must:

- refuse to start the task
- send a clear infrastructure error to the user
- avoid creating a fake running task lifecycle
- avoid requiring `/codex continue` for a task that never truly started

## Approved Direction

### 1. Fail closed before task start

Before the bridge sends `taskStarted` or spawns the Codex child process, it must validate that the execution runtime is compatible.

At minimum this check must verify:

- `codex` is available
- `bwrap` is available
- `bwrap` version is at least `0.9.0`

If any check fails, the bridge should return an explicit infrastructure error and stop.

### 2. Keep compatibility policy explicit and narrow

This pass should not add an execution fallback path.

The product should not silently switch to a less-controlled execution mode just because the host machine is missing the required sandbox capability.

That would weaken the product boundary and make execution semantics depend on host quirks.

### 3. Align runtime behavior with bootstrap behavior

The same compatibility requirement should exist in both:

- runtime task start checks in the bridge
- deployment/bootstrap preflight checks in `scripts/bootstrap-codex-feishu.sh`

This reduces the chance of a service appearing healthy while being unable to execute normal tasks.

### 4. Document minimum infrastructure clearly

The public `README.md` should state the minimum tested infrastructure baseline, including:

- `bubblewrap >= 0.9.0`
- `codex-cli 0.116.0` as the current tested Codex baseline
- the fact that the runner will reject task start when the host runtime is below the minimum supported compatibility level

The compatibility gate itself should enforce:

- `codex` exists
- `bwrap` exists
- `bwrap >= 0.9.0`

The `codex-cli 0.116.0` note should be documented as the current verified baseline, not as an enforced hard minimum in this pass.

## User-Visible Requirement

When the host runtime is incompatible, any task start attempt should produce:

- explicit infrastructure failure
- no `task started` message
- no fake `running` state
- no misleading `awaiting_input` continuation path
- no persisted active task or active run for that attempted start
- no `profile.activeTaskId` left behind by the failed attempt

## Files In Scope

- `extensions/codex-bridge/index.js`
- `extensions/codex-bridge/lib/` if a small helper is warranted
- `extensions/codex-bridge/test/`
- `scripts/bootstrap-codex-feishu.sh`
- `README.md`

## Test Requirements

This repair must add coverage for:

1. runtime compatibility check rejects task start on unsupported Bubblewrap versions
2. runtime compatibility check rejects task start when `codex` or `bwrap` is missing
3. bridge does not create any active task/run persistence or `/codex continue` path when compatibility preflight fails
4. approved high-risk starts and explicit `/codex continue` starts also fail closed without residue when compatibility preflight fails
5. bootstrap preflight fails closed on unsupported Bubblewrap versions or missing required commands
6. compatible version parsing accepts `0.9.0` and newer, rejects lower versions

## Non-Goals

This pass does not:

- redesign Codex CLI sandbox behavior
- replace Bubblewrap with another sandbox backend
- add a degraded fallback execution mode
- solve unrelated formatting or UX issues such as raw internal status hints

## Success Criteria

This P0 is fixed if:

- incompatible hosts are rejected before task start
- users no longer see a fake successful task lifecycle when shell execution is impossible
- incompatible preflight failures do not leave active task/run/profile state behind
- bootstrap and runtime checks agree on the same minimum compatibility contract
- the minimum infrastructure contract is documented publicly
