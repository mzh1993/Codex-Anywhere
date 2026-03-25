# Execution Runtime Compatibility P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject any task start path before entering the running lifecycle when the host execution runtime is incompatible with the Codex CLI sandbox requirements, and document the minimum supported infrastructure baseline.

**Architecture:** Add one narrow compatibility contract for the execution core and enforce it in two places: bridge runtime task start and bootstrap preflight. The bridge should fail closed before `taskStarted` and before spawning a child process, while bootstrap should fail closed before advertising a healthy deployment. Public docs should state the minimum tested baseline so operators know exactly what must be installed.

**Tech Stack:** Node.js, existing bridge runtime/tests, Bash bootstrap script, Markdown documentation, `node:test`

---

### Task 1: Add failing regression coverage for runtime compatibility gating

**Files:**
- Create: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/index.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write a failing test for Bubblewrap version parsing and compatibility decisions**
- [ ] **Step 2: Write a failing test proving bridge task start is rejected before any active task/run/profile state is persisted when Bubblewrap is below `0.9.0`**
- [ ] **Step 3: Write a failing test proving missing `codex` or missing `bwrap` also fail closed with the same no-residue behavior**
- [ ] **Step 4: Write a failing test proving no `taskStarted` reply and no `/codex continue` path are created on compatibility failure, including approved-start and explicit-continue paths**
- [ ] **Step 5: Run the targeted test file and verify it fails for the expected missing behavior**

Run: `npm --prefix extensions/codex-bridge test -- test/runtime-compatibility.test.js`
Expected: FAIL showing missing compatibility parsing / pre-start fail-closed behavior

### Task 2: Implement bridge-side fail-closed compatibility checks

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Create or Modify: `extensions/codex-bridge/lib/runtime-compatibility.js`
- Modify: `extensions/codex-bridge/lib/locale.js`

- [ ] **Step 1: Add a focused helper that checks `codex` presence, `bwrap` presence, and minimum `bwrap >= 0.9.0` compatibility**
- [ ] **Step 2: Keep version parsing explicit and deterministic, with tests for accepted and rejected versions**
- [ ] **Step 3: Call the compatibility check before task persistence enters `running` and before `taskStarted` is sent for new tasks, approved tasks, and explicit continue starts**
- [ ] **Step 4: Return an explicit infrastructure error reply instead of creating any fake running or resumable task lifecycle**
- [ ] **Step 5: Re-run targeted tests and verify the bridge-side regressions turn green**

Run: `npm --prefix extensions/codex-bridge test -- test/runtime-compatibility.test.js`
Expected: PASS

### Task 3: Enforce the same contract in bootstrap preflight

**Files:**
- Modify: `scripts/bootstrap-codex-feishu.sh`
- Test: one-off shell validation command in this repo

- [ ] **Step 1: Add a bootstrap preflight check for `codex` existence, `bwrap` existence, and minimum `bwrap` version `0.9.0`**
- [ ] **Step 2: Make the script fail closed with a precise operator-facing error message**
- [ ] **Step 3: Verify the script still passes on compatible hosts and clearly fails on simulated incompatible input if a test seam is practical**

Run: `bash scripts/bootstrap-codex-feishu.sh preflight`
Expected: PASS on this upgraded host, or explicit fail-closed message on incompatible hosts

### Task 4: Document the minimum supported infrastructure baseline

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a concise minimum infrastructure section with enforced `bubblewrap >= 0.9.0` and documented `codex-cli 0.116.0` verified baseline**
- [ ] **Step 2: State that the runner rejects task start when execution-core compatibility checks fail**
- [ ] **Step 3: Keep the README wording lightweight and operator-oriented**

### Task 5: Upgrade and verify the local host infrastructure

**Files:**
- No repository file changes required unless operator notes are needed

- [ ] **Step 1: Upgrade local `bubblewrap` to `>= 0.9.0` using the safest available system package path**
- [ ] **Step 2: Verify `bwrap --version` now meets the documented minimum**
- [ ] **Step 3: Re-run bridge tests, syntax check, and bootstrap checks on the upgraded host**
- [ ] **Step 4: Re-run the original Feishu smoke test: summarize `README.md` in three sentences, and confirm it no longer fails with `--argv0`**

Run: `bwrap --version && npm --prefix extensions/codex-bridge test && npm --prefix extensions/codex-bridge run check && bash scripts/bootstrap-codex-feishu.sh preflight`
Expected: compatible Bubblewrap version and all checks passing
