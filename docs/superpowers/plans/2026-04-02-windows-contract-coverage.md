# Windows Contract Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove that the latest continuity and running-card UX guarantees also hold under `native_windows_fast`.

**Architecture:** Reuse the existing Linux-path contract tests as the semantic source of truth, then add Windows-runtime variants that assert the same continuity/card outcomes where they should remain identical. Keep the scope test-only unless a Windows-specific behavior gap is exposed.

**Tech Stack:** Node.js ESM, OpenClaw plugin runtime, built-in `node:test`

---

### Task 1: Lock Windows Continuity Contracts

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a Windows restart-lane continuity test**

Mirror the existing `gateway-stop` continuity test with `pluginConfig.runtimeMode = "native_windows_fast"` and assert that `activeTaskId`, `cwd`, `sessionId`, and `requiresExplicitContinue` are preserved.

- [ ] **Step 2: Run the focused test and confirm the result**

Run:

```bash
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern="gateway-stop"
```

Expected: PASS if the Windows runtime already honors the same continuity contract; otherwise FAIL with a continuity mismatch worth fixing.

### Task 2: Lock Windows Presentation Contracts

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a Windows same-card finish test**

Mirror the existing `finish updates the existing progress card` test with `pluginConfig.runtimeMode = "native_windows_fast"` and assert that finish still updates `progressMessageId` instead of emitting a second lifecycle reply.

- [ ] **Step 2: Add a Windows recovered-lane resume test**

Mirror the existing `first plain-text message after gateway-stop continues the same task` test with `pluginConfig.runtimeMode = "native_windows_fast"` and assert that the same task is resumed rather than replaced.

- [ ] **Step 3: Run focused Windows contract tests**

Run:

```bash
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern="native_windows_fast|gateway-stop|progress card"
```

Expected: PASS if Windows semantics match the intended thin-bridge continuity model; otherwise FAIL with the exact divergent contract.

### Task 3: Verify The Whole Bridge

**Files:**
- No further files unless a Windows-specific bug is exposed

- [ ] **Step 1: Re-run full bridge tests**

Run:

```bash
node --test extensions/codex-bridge/test/*.test.js
```

- [ ] **Step 2: Review whether any production code change is actually necessary**

If the Windows contract tests pass as written, keep the change test-only. If they fail, make the smallest runtime fix and rerun the same focused + full suite.
