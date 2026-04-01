# Explicit New Session Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make explicit `/codex --cd ...` always start a fresh bridge task instead of resuming stale history, and close legacy top-level session commands like `/new` and `/reset`.

**Architecture:** Keep the bridge thin: plain natural language still goes to the current Codex lane, explicit `/codex resume` remains the only explicit resume surface, and explicit `/codex --cd ...` becomes the only explicit new-task surface. Close legacy top-level session commands at claim time so they no longer bypass into upstream session logic.

**Tech Stack:** Node.js, OpenClaw plugin hooks, existing `node:test` bridge protocol tests

---

### Task 1: Lock the explicit-new contract with tests

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] Add a failing test that an active `awaiting_input` task does not block explicit `/codex --cd ...` new-task entry.
- [ ] Add a failing test that legacy top-level `/new` is claimed and closed instead of bypassing to upstream.
- [ ] Run the targeted test file and confirm the new assertions fail for the expected reasons.

### Task 2: Patch the bridge routing

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/locale.js`

- [ ] Add a narrow legacy top-level command closer for `/new` and `/reset`.
- [ ] On explicit native new-task entry, abort stale non-running bridge tasks before creating the fresh task.
- [ ] Keep explicit `/codex resume ...` as the only explicit resume path.

### Task 3: Align user-facing docs

**Files:**
- Modify: `README.md`
- Modify: `docs/feishu-codex-bridge-v1.md`

- [ ] State that bridge no longer relies on `/new` or `/reset` text semantics and that these legacy top-level session commands are closed on the paired bridge surface.
- [ ] Re-state that explicit new work starts via `/codex --cd ...` and explicit continuation uses `/codex resume ...`.

### Task 4: Verify the closure

**Files:**
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`

- [ ] Run the focused protocol test set.
- [ ] Confirm the new-task path no longer emits `active_task_exists` for stale awaiting-input history.
- [ ] Confirm `/new` no longer bypasses into upstream native session handling on the bridge path.
