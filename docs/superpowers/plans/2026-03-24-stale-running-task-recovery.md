# Stale Running Task Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Recover stale persisted `running` tasks to `awaiting_input` after bridge restart, with an explicit interruption hint.

**Architecture:** Add a narrow persistence-recovery path in the bridge loader: if a stored task is `running` but has no live runtime in the current bridge process, treat the previous run as interrupted, persist the task back to `awaiting_input`, and surface a stable user-facing hint. Keep heartbeat timeout observational only; do not infer liveness from silence.

**Tech Stack:** Node.js, existing bridge task/run persistence, node:test

---

### Task 1: Add failing recovery tests

**Files:**
- Modify: `extensions/codex-bridge/test/task-store.test.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run targeted tests and confirm failure**
- [ ] **Step 3: Implement minimal recovery behavior**
- [ ] **Step 4: Re-run targeted tests and confirm pass**

### Task 2: Recover stale running tasks in bridge load path

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/lib/locale.js`

- [ ] **Step 1: Add helper that converts stale running task/run into awaiting_input + interruption hint**
- [ ] **Step 2: Call it from `loadActiveTask()` when no live runtime exists for a persisted running task**
- [ ] **Step 3: Keep approval-expiry logic unchanged and do not add heartbeat-based recovery**
- [ ] **Step 4: Ensure recovered task remains active and continuable**

### Task 3: Verify and document operator-visible behavior

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Document stale running task recovery semantics**
- [ ] **Step 2: Run `npm --prefix extensions/codex-bridge test`**
- [ ] **Step 3: Run `npm --prefix extensions/codex-bridge run check`**
- [ ] **Step 4: Run `bash scripts/bootstrap-codex-feishu.sh render-config`**
