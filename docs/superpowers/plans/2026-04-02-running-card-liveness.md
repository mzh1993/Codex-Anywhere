# Running Card Liveness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep one stable running card alive during long Codex runs so the user never loses confidence that the task is still active.

**Architecture:** Reuse the existing `progressMessageId` as the sole lifecycle card anchor. Adjust heartbeat cadence and dedupe so unchanged long-running tasks still refresh within 60 seconds, and route task finish through the same card anchor.

**Tech Stack:** Node.js ESM, OpenClaw plugin runtime, built-in `node:test`

---

### Task 1: Lock The Liveness Contract In Tests

**Files:**
- Modify: `extensions/codex-bridge/test/persistence-reliability.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a failing keepalive test**

Assert a long-running task with unchanged visible status still emits another heartbeat refresh once the bounded silence interval is exceeded.

- [ ] **Step 2: Add a failing finish-card test**

Assert finishing a task with an existing `progressMessageId` updates that same card instead of creating a new lifecycle reply.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run:

```bash
node --test extensions/codex-bridge/test/persistence-reliability.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
```

Expected: FAIL on the new liveness assertions.

### Task 2: Keep The Same Card Alive

**Files:**
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Make task start establish the main progress card anchor**

Ensure the first visible lifecycle card participates in `progressMessageId` reuse.

- [ ] **Step 2: Replace coarse heartbeat silence with bounded keepalive**

Allow unchanged long-running tasks to refresh within 60 seconds instead of going quiet for minutes.

- [ ] **Step 3: Route task finish through the same card anchor**

If `progressMessageId` exists, update that same card into the result state.

### Task 3: Verify And Document

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`

- [ ] **Step 1: Re-run focused liveness tests**

Run:

```bash
node --test extensions/codex-bridge/test/persistence-reliability.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
```

- [ ] **Step 2: Re-run full bridge tests**

Run:

```bash
node --test extensions/codex-bridge/test/*.test.js
```

- [ ] **Step 3: Document the user-visible contract**

Add a short statement that long-running tasks keep one stable running card alive with bounded silence.
