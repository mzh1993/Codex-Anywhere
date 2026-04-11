# Help And Default Cwd Portability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/codex` help text copyable in Feishu and remove machine-specific default cwd leakage while keeping the current native command surface unchanged.

**Architecture:** Keep scope intentionally small: preserve the existing parser, switch default cwd fallback from a hardcoded host path to the current user home directory, replace swallowed angle-bracket placeholders with real copyable examples, and record the command-surface contract so tests enforce low-cognitive-load help without expanding bridge semantics.

**Tech Stack:** Node.js ESM, built-in `node:test`, bridge locale/settings modules, Markdown contract docs

---

### Task 1: Lock the UX contract with failing tests

**Files:**
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add locale-level help assertions**

Assert that help and recovery text:
- use copyable examples that the current parser already supports
- avoid angle-bracket placeholders
- avoid legacy closed command hints
- describe default cwd semantically instead of echoing a machine path

- [ ] **Step 2: Add runtime-level fallback assertions**

Assert that `/codex help`, `/codex status`, and `/codex pwd` all fall back to the same short help contract without leaking profile/default absolute cwd paths.

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:
- `node --test test/routing.test.js --test-name-pattern='help|unknown_command|recovery'`
- `node --test test/runtime-compatibility.test.js --test-name-pattern='command_surface/help|command_surface/status|command_surface/pwd|unknown_command'`

Expected: FAIL on the old placeholder/path assertions.

### Task 2: Implement the minimal runtime and locale fix

**Files:**
- Modify: `extensions/codex-bridge/lib/settings.js`
- Modify: `extensions/codex-bridge/lib/locale.js`

- [ ] **Step 1: Fix default cwd fallback**

Use `pluginConfig.defaultCwd` when provided; otherwise fall back to `os.homedir()` instead of a machine-specific hardcoded path.

- [ ] **Step 2: Replace swallowed placeholders with real examples**

Update help, unknown-command, usage, interrupted-task fallback, and active-task fallback strings to use copyable examples such as `/codex --cd . 帮我看看当前目录` and `/codex resume 继续`.

- [ ] **Step 3: Keep command-surface scope closed**

Do not add support for `/codex <prompt>` in this change; help text must only advertise flows that parse today.

### Task 3: Record the command-surface contract

**Files:**
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Add or update command/help contract wording**

Document that help/fallback text must stay platform-neutral, copyable in Feishu, and must not leak deployment-specific default cwd paths.

### Task 4: Verify the fix

**Files:**
- Verify only

- [ ] **Step 1: Re-run the targeted tests**

Run:
- `node --test test/routing.test.js --test-name-pattern='help|unknown_command|recovery'`
- `node --test test/runtime-compatibility.test.js --test-name-pattern='command_surface/help|command_surface/status|command_surface/pwd|unknown_command'`

Expected: PASS

- [ ] **Step 2: Run the focused bridge suites**

Run:
- `node --test test/routing.test.js test/runtime-compatibility.test.js`

Expected: PASS

- [ ] **Step 3: Run patch hygiene checks**

Run:
- `git diff --check`

Expected: no whitespace or patch errors.
