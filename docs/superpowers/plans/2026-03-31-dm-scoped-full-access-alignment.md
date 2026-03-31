# DM-Scoped Full Access Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make paired-DM permission behavior align with native Codex Full Access by persisting a DM-scoped full-access state that future tasks inherit until explicit downgrade or reset.

**Architecture:** Persist a thin `accessMode` flag on the sender profile, derive default task `riskLevel` from that flag, and clear it on reset. Keep bridge action execution and Codex task execution separate, but make their user-visible permission semantics consistent at the DM level.

**Tech Stack:** Node.js, built-in `node:test`, existing `extensions/codex-bridge` profile/task persistence and routing code

---

### Task 1: Add failing tests for DM-scoped full-access persistence

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/runtime-control-plane.test.js`

- [ ] **Step 1: Write the failing test**

```js
test("approvePendingRequest persists DM full-access mode", async () => {
  // Arrange profile + approval-required request
  // Act approvePendingRequest(...)
  // Assert persisted profile.accessMode === "full_access"
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL because `accessMode` is not persisted yet.

- [ ] **Step 3: Write minimal implementation**

Update approval flow to persist DM-level `accessMode`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS for the new case.

- [ ] **Step 5: Commit**

```bash
git add extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/index.js
git commit -m "feat: persist dm full access state"
```

### Task 2: Add failing tests for inherited risk on future tasks

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Write the failing tests**

```js
test("explicit new task inherits DM full access", async () => {
  // Arrange profile.accessMode = "full_access"
  // Act through explicit /codex --cd ...
  // Assert startTask receives riskLevel "high"
});

test("resume inherits DM full access when no explicit override is provided", async () => {
  // Arrange profile.accessMode = "full_access"
  // Act through resume path
  // Assert high-risk task/run is created
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL because default inheritance still falls back to `normal`.

- [ ] **Step 3: Write minimal implementation**

Teach `startTask` and relevant routing paths to derive default risk from profile `accessMode`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS for new inheritance cases.

- [ ] **Step 5: Commit**

```bash
git add extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/index.js
git commit -m "feat: inherit dm full access for new runs"
```

### Task 3: Add failing tests for reset clearing DM full access

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Write the failing test**

```js
test("before_reset clears DM full access mode", async () => {
  // Arrange persisted profile.accessMode = "full_access"
  // Act handleBeforeReset(...)
  // Assert profile.accessMode resets to "normal" or profile removed
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL because reset does not explicitly clear the new field yet.

- [ ] **Step 3: Write minimal implementation**

Clear the persisted DM access mode inside reset cleanup paths.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/index.js
git commit -m "fix: clear dm full access on reset"
```

### Task 4: Add capability-truthfulness coverage

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-control-plane.test.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/locale.js`

- [ ] **Step 1: Write the failing test**

```js
test("status text does not imply host capability when only DM full access is granted", async () => {
  // Arrange DM full access + runtime capability missing
  // Act status/report path
  // Assert wording says permission/high-risk mode without claiming GPU/system resources are visible
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test extensions/codex-bridge/test/runtime-control-plane.test.js`
Expected: FAIL because wording is missing or ambiguous.

- [ ] **Step 3: Write minimal implementation**

Adjust user-visible wording to distinguish logical full access from underlying host capability.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test extensions/codex-bridge/test/runtime-control-plane.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extensions/codex-bridge/test/runtime-control-plane.test.js extensions/codex-bridge/index.js extensions/codex-bridge/lib/locale.js
git commit -m "fix: report full access without overstating host capability"
```

### Task 5: Full verification and doc touch-up

**Files:**
- Modify: `README.md`
- Modify: `docs/feishu-codex-bridge-v1.md`

- [ ] **Step 1: Update docs to reflect DM-scoped full-access behavior**

Describe that paired DM can remember Full Access until explicit downgrade or reset, while host capability still depends on runtime visibility.

- [ ] **Step 2: Run focused bridge test suite**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/routing.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-control-plane.test.js`
Expected: PASS with no regressions.

- [ ] **Step 3: Run targeted smoke checks if needed**

Run: `node --test extensions/codex-bridge/test/persistence-reliability.test.js`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/feishu-codex-bridge-v1.md extensions/codex-bridge
git commit -m "feat: align bridge full access with dm-scoped codex state"
```
