# Legacy Command Shutdown Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disable legacy `/codex help|status|abort|approve` execution so only native-first entrypoints plus `/codex doctor` remain executable.

**Architecture:** Remove the compat execution lane from the command fallback path, collapse fallback behavior to `doctor` or native-first unknown handling, and rewrite docs/tests so legacy slash commands are treated as closed historical surface rather than degraded-but-available compatibility. Keep task approval and bridge approval semantics on natural-language and explicit native flows only.

**Tech Stack:** Node.js, built-in `node:test`, existing bridge routing/locale/docs files

---

### Task 1: Remove compat execution lane

**Files:**
- Modify: `extensions/codex-bridge/lib/command-fallback-router.js`
- Modify: `extensions/codex-bridge/index.js`
- Delete: `extensions/codex-bridge/lib/compat-command-router.js`

- [ ] **Step 1: Write the failing test**

Update command fallback tests so legacy subcommands are expected to fall through to unknown handling instead of compat execution.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `node --test extensions/codex-bridge/test/command-fallback-router.test.js extensions/codex-bridge/test/compat-command-router.test.js extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: failures showing legacy commands still execute.

- [ ] **Step 3: Write minimal implementation**

Remove compat routing import/call sites and keep fallback router responsible only for `/codex doctor` and unknown subcommands.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `node --test extensions/codex-bridge/test/command-fallback-router.test.js extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: PASS.

### Task 2: Rewrite legacy command contract tests

**Files:**
- Delete: `extensions/codex-bridge/test/compat-command-router.test.js`
- Modify: `extensions/codex-bridge/test/command-fallback-router.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Write the failing test**

Replace compat-surface assertions with shutdown assertions for all four legacy subcommands.

- [ ] **Step 2: Run targeted tests to verify they fail**

Run: `node --test extensions/codex-bridge/test/command-fallback-router.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/routing.test.js`
Expected: failures because docs/runtime still treat legacy commands as executable.

- [ ] **Step 3: Write minimal implementation**

Adjust runtime expectations so `/codex help|status|abort|approve` all return the same native-first unknown-command behavior.

- [ ] **Step 4: Run targeted tests to verify they pass**

Run: `node --test extensions/codex-bridge/test/command-fallback-router.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/routing.test.js`
Expected: PASS.

### Task 3: Sync docs and roadmap

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Write the failing doc assertions**

Identify and remove wording that still frames legacy compat commands as retained/executable.

- [ ] **Step 2: Update docs**

State clearly that compat slash commands are closed and unknown legacy subcommands now return native-first guidance only.

- [ ] **Step 3: Review for consistency**

Check both docs for agreement on `/codex doctor` as the only bridge command and on bridge not hijacking normal Codex semantics.

### Task 4: Verify the closure batch

**Files:**
- Verify only

- [ ] **Step 1: Run full bridge suite**

Run: `node --test extensions/codex-bridge/test/*.test.js`
Expected: PASS with zero failures.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check && git status --short`
Expected: no whitespace errors; only intended files changed.
