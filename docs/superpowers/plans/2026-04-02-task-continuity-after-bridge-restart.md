# Task Continuity After Bridge Restart Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the same Codex task lane across bridge/gateway restarts so the next plain-text message resumes the interrupted task instead of silently creating a new one.

**Architecture:** Treat `task` as continuity state and `run` as one execution attempt. Update restart recovery and shutdown persistence so interruption keeps `profile.activeTaskId` attached to the recovered task. Then verify plain-text routing continues the recovered task by default while explicit new-task commands still replace the lane intentionally.

**Tech Stack:** Node.js, OpenClaw plugin runtime, built-in `node:test`, JSON task/profile persistence

---

### Task 1: Lock The Intended Recovery Contract In Tests

**Files:**
- Modify: `extensions/codex-bridge/test/task-store.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a failing task-store test for restart recovery semantics**

Add a test that asserts recovered running tasks remain resumable continuity anchors and do not represent terminal lane loss.

- [ ] **Step 2: Add a failing runtime test for post-restart plain-text continuation**

Cover this sequence:
1. create a running task
2. simulate bridge stop / stale recovery
3. reload active task from persisted profile
4. send plain text
5. assert the same `taskId` is continued and its `cwd` is reused

- [ ] **Step 3: Add a failing runtime test for explicit new-task replacement**

After the same recovery setup, send explicit `/codex --cd ... <prompt>` and assert a new task replaces the active lane intentionally.

- [ ] **Step 4: Run the targeted tests and confirm failure**

Run:

```bash
node --test extensions/codex-bridge/test/task-store.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
```

Expected: the new recovery-contract assertions fail under current behavior.

### Task 2: Keep Recovered Tasks Attached To The Active Lane

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`

- [ ] **Step 1: Adjust stale-running-task recovery semantics**

Ensure the recovery helper produces a resumable task state meant to preserve lane continuity.

- [ ] **Step 2: Update active-task loading so recovered tasks stay active**

In `loadActiveTask`, after recovering a stale running task, keep `profile.activeTaskId` logically attached to that task instead of letting later terminal-state cleanup drop the lane.

- [ ] **Step 3: Update shutdown/finish behavior so gateway interruption does not destroy continuity**

Review the `gateway_stop -> abortAll -> stopTask -> finishTask` path and make sure the resulting persistence matches the new continuity contract.

- [ ] **Step 4: Keep user-visible behavior minimal**

Do not add new commands. If interruption messaging is touched, keep it as a thin status hint only.

### Task 3: Verify End-To-End Continuity Routing

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Re-run the focused recovery tests**

Run:

```bash
node --test extensions/codex-bridge/test/task-store.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
```

Expected: all new recovery continuity tests pass.

- [ ] **Step 2: Run the full bridge test suite**

Run:

```bash
node --test extensions/codex-bridge/test/*.test.js
```

Expected: no regressions in approval, routing, or control-plane behavior.

- [ ] **Step 3: Inspect the changed contract against top-level docs**

Confirm the behavior still matches:
- `docs/product-north-star.md`
- `docs/product-decision-baseline.md`
- `docs/feishu-codex-bridge-v1.md`

### Task 4: Document The Behavioral Contract

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`

- [ ] **Step 1: Add the restart continuity rule**

Document that bridge/gateway interruption preserves task continuity and that the next plain-text message resumes the interrupted lane by default.

- [ ] **Step 2: Keep wording aligned with thin-bridge principles**

Make explicit that this is continuity preservation, not bridge expansion into ordinary text semantics.

- [ ] **Step 3: Re-run relevant tests after doc/code changes**

Run:

```bash
node --test extensions/codex-bridge/test/task-store.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/policy.test.js
```

Expected: pass.

### Task 5: Final Verification And Commit

**Files:**
- Modify: `git status` output only

- [ ] **Step 1: Verify worktree contents**

Run:

```bash
git status --short
```

Expected: only intended files changed.

- [ ] **Step 2: Capture the behavioral diff**

Run:

```bash
git diff -- extensions/codex-bridge/index.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/test/task-store.test.js extensions/codex-bridge/test/runtime-compatibility.test.js docs/feishu-codex-bridge-v1.md
```

Expected: diff only reflects continuity-preservation changes.

- [ ] **Step 3: Commit**

```bash
git add extensions/codex-bridge/index.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/test/task-store.test.js extensions/codex-bridge/test/runtime-compatibility.test.js docs/feishu-codex-bridge-v1.md docs/superpowers/specs/2026-04-02-task-continuity-after-bridge-restart-design.md docs/superpowers/plans/2026-04-02-task-continuity-after-bridge-restart.md
git commit -m "fix: preserve task continuity across bridge restart"
```
