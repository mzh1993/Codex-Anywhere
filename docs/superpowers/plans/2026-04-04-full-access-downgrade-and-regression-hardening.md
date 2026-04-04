# Full Access Downgrade And Regression Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a native-feeling explicit downgrade path for DM-scoped `full_access`, anchor that behavior in the contract matrix, and make experience regression enforcement real in CI.

**Architecture:** Keep the bridge thin by reusing the native `--sandbox` flag surface instead of adding a new bridge command. Treat explicit `--sandbox workspace-write` as the reverse of remembered `full_access` for the current paired DM, document the behavior, protect it with targeted runtime tests, and harden regression workflow enforcement so “institutionalized review” is not only manual policy text.

**Tech Stack:** Node.js ESM, `node:test`, existing bridge runtime/task persistence helpers, GitHub Actions, Markdown governance docs

---

### Task 1: Add contract coverage for DM-scoped access memory

**Files:**
- Modify: `docs/contract-matrix.md`
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `README.md`

- [ ] **Step 1: Add a `full_access` contract row**

Document that DM-scoped access memory must support three user-visible transitions: approval grants `full_access`, `before_reset` clears it, and explicit native `--sandbox workspace-write` clears it.

- [ ] **Step 2: Align V1 wording**

Clarify that the lowest-cognitive explicit downgrade path is still native `/codex` surface: `/codex ... --sandbox workspace-write ...`.

- [ ] **Step 3: Align README wording**

Keep help/README concise: mention downgrade only in advanced semantics, not as a new top-level bridge command.

### Task 2: Add failing tests for explicit downgrade

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/codex-exec.test.js`

- [ ] **Step 1: Add runtime test for explicit new-task downgrade**

Cover: existing DM profile has `accessMode=full_access`; explicit `/codex --cd ... --sandbox workspace-write <prompt>` starts with normal risk and clears stored `accessMode`.

- [ ] **Step 2: Run the new targeted runtime test and confirm RED**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern="full_access"`

Expected: new downgrade case fails before implementation.

- [ ] **Step 3: Add codex exec arg-level test**

Cover that non-high-risk explicit `workspace-write` still maps to `-s workspace-write`, proving downgrade preserves native sandbox semantics instead of inventing a bridge-only path.

- [ ] **Step 4: Run codex exec test and confirm RED if needed**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js`

Expected: new downgrade assertion fails before implementation.

### Task 3: Implement explicit downgrade with native `--sandbox workspace-write`

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/codex-exec.js`

- [ ] **Step 1: Adjust risk resolution**

When a remembered `full_access` profile receives an explicit native sandbox request other than `danger-full-access`, do not force `riskLevel=high` from profile memory for that run.

- [ ] **Step 2: Persist downgrade**

When an explicit native `/codex` start or resume uses `--sandbox workspace-write`, clear DM-scoped `accessMode` back to normal before/with task persistence.

- [ ] **Step 3: Preserve current full-access behavior**

Do not change approval-grant persistence, `before_reset` clearing, or remembered high-risk defaults when no explicit sandbox downgrade is provided.

- [ ] **Step 4: Run targeted tests and confirm GREEN**

Run:
- `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern="full_access"`
- `node --test extensions/codex-bridge/test/codex-exec.test.js`

Expected: all pass.

### Task 4: Make experience regression enforcement real

**Files:**
- Modify: `scripts/review/run-experience-regression.sh`
- Create: `.github/workflows/experience-regression.yml`

- [ ] **Step 1: Add a stricter timeout success rule**

Require timeout-allowed success only when the log contains evidence that the suite actually executed and produced passing subtests, not merely “no `not ok` seen yet”.

- [ ] **Step 2: Add CI workflow**

Run the fixed experience regression script on `pull_request` and `push` so the repo’s documented review discipline is no longer manual-only.

- [ ] **Step 3: Run the regression script locally**

Run: `scripts/review/run-experience-regression.sh`

Expected: exits `0` only with actual execution evidence.

### Task 5: Final verification

**Files:**
- Verify only

- [ ] **Step 1: Run targeted semantic suites**

Run:
- `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern="full_access|native_entry/permissions"`
- `node --test extensions/codex-bridge/test/codex-exec.test.js`
- `node --test extensions/codex-bridge/test/persistence-reliability.test.js`
- `node --test extensions/codex-bridge/test/runtime-contract.test.js`

- [ ] **Step 2: Run governance guards**

Run:
- `scripts/review/check-contract-matrix.sh origin/main...HEAD`
- `scripts/review/run-experience-regression.sh`

- [ ] **Step 3: Review final diff**

Run:
- `git diff -- docs/contract-matrix.md docs/feishu-codex-bridge-v1.md README.md extensions/codex-bridge/index.js extensions/codex-bridge/lib/codex-exec.js scripts/review/run-experience-regression.sh .github/workflows/experience-regression.yml extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/codex-exec.test.js`
