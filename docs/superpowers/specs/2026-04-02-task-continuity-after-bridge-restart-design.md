# Task Continuity After Bridge Restart Design

> Scope: fix the user-facing continuity break where a bridge/gateway restart causes the next plain-text message to open a new task instead of continuing the interrupted lane.

## Problem

Current behavior treats `gateway stop` as the end of the active task lane. When the gateway is restarted by OOM, manual restart, or host reboot, the old run is stopped and the task is later observed as terminal. The next natural-language message therefore creates a fresh task, often with the profile default `cwd`, which feels like lane drift to the user.

This conflicts with the product north star:

- remote usage should feel as close as possible to native `Codex`
- the bridge should stay thin
- ordinary natural language should continue the current `Codex` lane unless the user explicitly starts a new one

## Product Decision

For restart/interruption scenarios, the bridge must preserve task continuity by default.

- A `task` represents the user-visible continuous lane.
- A `run` represents one concrete execution attempt inside that lane.
- Bridge/gateway interruption ends the current `run`, not the `task`.
- Unless the user explicitly starts a new lane or resets, the next plain-text message should continue the interrupted `task`.

## Required User Experience

After a bridge restart:

- the previous `taskId` remains the active lane
- the previous `cwd`, `sessionId`, risk level, and execution defaults remain attached to that lane
- the bridge may tell the user the run was interrupted, but it must not silently switch them onto a different task
- the next plain-text message should resume the same task by default

## Non-Goals

- No new user-visible command surface
- No automatic background re-execution of the interrupted run
- No attempt to reconstruct hidden execution state beyond what is already persisted
- No expansion of bridge ownership over ordinary text semantics

## Minimal State Semantics

### Task

`task` remains the continuity anchor. A restart-interrupted task must stay in an active, resumable state rather than falling into a terminal state.

### Run

The interrupted `run` is finalized as interrupted/failed-aborted according to existing persistence semantics, but this must not clear the continuity lane.

### Profile

`profile.activeTaskId` must continue to point at the interrupted task after restart recovery. Clearing `activeTaskId` is only valid when:

- the user explicitly starts a new task
- the user explicitly resets the lane
- the task is intentionally abandoned or denied by product policy

`gateway stop` alone is not enough reason to clear continuity.

## Recovery Rules

### Rule 1: Shutdown Is Interruption, Not Lane Termination

When the bridge receives `gateway_stop` or recovers a stale running task after restart, it must persist the lane as resumable. It may record interruption details, but the task remains the active lane.

### Rule 2: Plain Text Defaults To Continuation

If the recovered task is resumable, a plain-text message continues that same task by default. The bridge must not create a fresh task while such a recovered lane still exists.

### Rule 3: Explicit New Still Wins

An explicit `/codex --cd ...` new-task entry may replace the current continuity lane. This preserves native control semantics and avoids bridge guesswork.

## Constraints

- Keep the bridge thin: continuity is a persistence rule, not a new control-plane feature
- Do not add new top-level commands
- Do not change approval ownership rules
- Do not infer new bridge-owned semantics from ordinary text

## Acceptance Criteria

- After a simulated `gateway stop`, the interrupted task remains the active task in profile state
- Loading active state after restart returns the same interrupted task as resumable
- A subsequent plain-text message continues the same `taskId`
- The continued run inherits the previous lane `cwd`
- A fresh explicit `/codex --cd ...` still starts a new task intentionally

## Files Likely Affected

- `extensions/codex-bridge/index.js`
- `extensions/codex-bridge/lib/task-store.js`
- `extensions/codex-bridge/test/runtime-compatibility.test.js`
- `extensions/codex-bridge/test/task-store.test.js`
