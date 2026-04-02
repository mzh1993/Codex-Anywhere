# Running Card Liveness Design

> Scope: strengthen long-running task observability so the user keeps seeing one stable running card with bounded silence, without expanding bridge product surface.

## Problem

Current long-running task updates become too quiet over time:

- heartbeats back off too aggressively
- same-bucket and same-hint dedupe can suppress updates for minutes
- users can no longer tell whether the lane is still alive

This violates the intended bridge contract:

- thin bridge does not mean weak liveness
- continuity must remain visible while a task is still running
- the user should not need to guess whether Codex is still working

## Product Decision

The bridge should keep exactly one visible running card alive during a run.

- progress updates refresh that same card
- heartbeat keepalive also refreshes that same card
- completion updates that same card into the final result state

User-visible guarantee:

- while a task is running, the card must not stay visually stale for longer than about 60 seconds

## Required User Experience

- Task start creates the main running card
- New visible status hint updates the same card immediately
- If no new visible hint appears, the bridge still refreshes the same card within a bounded interval
- Task finish updates the same card into its final state instead of creating a second lifecycle message

## Non-Goals

- No new user commands
- No richer bridge interpretation of task semantics
- No chatty heartbeat stream
- No second “shadow status” message lane

## Implementation Shape

### Single Progress Card

`progressMessageId` becomes the durable anchor for all user-visible lifecycle updates during a run:

- `task_started`
- `task_progress`
- `task_running`
- `task_finished`

### Bounded Silence

The heartbeat policy should preserve a hard upper bound on visible silence.

Recommended behavior:

- before 1 minute elapsed: use the base heartbeat interval
- after 1 minute elapsed: refresh no less often than every 60 seconds

### Dedupe Policy

Immediate repeated heartbeats should still be suppressed, but long-lived same-status runs must no longer be fully silenced by coarse elapsed buckets.

## Acceptance Criteria

- Starting a task stores a reusable `progressMessageId`
- Status hints update the same progress card instead of opening a new lifecycle message
- Long-running tasks with unchanged hint still emit keepalive refreshes within the bounded interval
- Finishing a task updates the same progress card into the final result state
- Existing bridge tests remain green

## Files Likely Affected

- `extensions/codex-bridge/index.js`
- `extensions/codex-bridge/test/persistence-reliability.test.js`
- `extensions/codex-bridge/test/runtime-compatibility.test.js`
- `docs/feishu-codex-bridge-v1.md`
