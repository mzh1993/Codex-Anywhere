# Task Persistence P0 Reliability Design

- Date: 2026-03-24
- Stage: approved design

## Goal

Fix the P0 reliability failure where a task is accepted, the user receives a task-start acknowledgement, and then the bridge silently dies because a task-state write collides and crashes the process.

## First Principle

Once the product tells the user that a task has started, the system must not silently disappear.

After a task-start acknowledgement, the user must always experience one of these visible outcomes:

- progress continues
- approval is required
- the task completes
- the task is explicitly interrupted or failed

The bridge must not crash due to persistence-path races while the user sees only silence.

## Confirmed Root Cause

The current JSON persistence helper uses a temporary file name derived from:

- target file path
- process id
- current millisecond timestamp

This is not unique enough when multiple writes hit the same file inside one process within the same millisecond.

That collision can produce:

- one writer renaming the shared temp file successfully
- another writer trying to rename the now-missing temp file
- `ENOENT`
- an unhandled rejection in the bridge
- process exit

Systemd can restart the process, but the user experiences a silent hang after receiving the initial task-start acknowledgement.

## Approved Repair Scope

This repair should do two things:

1. stop the temp-file collision itself
2. ensure a persistence failure does not crash the bridge without a controlled user-visible outcome

This pass should not redesign persistence as a new storage system. It is a P0 repair, not a storage migration.

## Approved Approach

### 1. Make atomic-write temp paths truly unique

Replace the current temp file naming strategy with one that is unique across same-process, same-millisecond concurrent writes.

Acceptable examples:

- `crypto.randomUUID()`
- random bytes appended to the temp file suffix

The important requirement is that two writes to the same logical file in the same millisecond do not reuse the same temp path.

### 2. Add controlled persistence-failure handling

Critical persistence paths must not let a raw write failure bubble out as an unhandled rejection that kills the bridge.

At minimum, task/run lifecycle persistence around active execution should be wrapped so that:

- the error is logged
- the active runtime is marked as interrupted or failed in memory when possible
- the user can be brought back to an explicit recovery path rather than silence

### 3. Preserve current recovery semantics

The current product semantics should remain:

- stale interrupted runs recover to `awaiting_input`
- explicit continue is required when the previous run was interrupted

This fix should strengthen that path, not redefine it.

## User-Visible Requirement

If persistence fails during task execution, the product must favor an explicit interruption/recovery outcome over a silent hang.

That means:

- no silent disappearance after “task started”
- if the task cannot continue safely, it should end in a recoverable interrupted state
- the next user interaction should make recovery obvious

## Files In Scope

- `extensions/codex-bridge/index.js`
- `extensions/codex-bridge/lib/task-store.js` if needed
- `extensions/codex-bridge/test/`

## Test Requirements

This repair must add regression coverage for:

1. temp file naming uniqueness / concurrent persistence safety
2. persistence failure does not crash task handling into a silent no-outcome state

The tests do not need to simulate the whole Feishu stack, but they must prove the bug and prove the repaired behavior.

## Non-Goals

This pass does not:

- migrate task storage to SQLite
- redesign the task/run protocol
- redesign messaging UX beyond making failure explicit

## Success Criteria

This P0 is fixed if:

- the original write-path collision can no longer occur
- persistence errors no longer kill the bridge as an unhandled rejection during a running task
- accepted tasks no longer fall into a silent hang caused by this persistence race
- interrupted tasks remain recoverable through the existing explicit-continue model
