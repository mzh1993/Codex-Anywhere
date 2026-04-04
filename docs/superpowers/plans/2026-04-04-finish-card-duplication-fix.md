# Finish Card Duplication Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix duplicated finish-card content so task result cards do not repeat summary, changed files, or next steps.

**Architecture:** Add a summary-section extractor for persisted task summaries, tighten changed-file extraction to avoid duplicate suffix matches, lock the bug with a failing runtime-compat regression test, and record the user-visible observability behavior in the contract matrix.

**Tech Stack:** Node.js, built-in `node:test`, bridge presentation/runtime persistence code, Markdown governance docs

---

### Task 1: Lock the bug with a failing regression test

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a regression test using the real duplicated finish-card sample**

The test should assert:
- persisted `summary` contains only the summary section
- persisted `changedFiles` contain full unique paths only
- rendered finish reply does not repeat `Changed Files` / `Next Steps` labels

- [ ] **Step 2: Run the targeted test and verify it fails for the current bug**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='finish_summary|finish card'`
Expected: FAIL on the duplicated finish-card regression.

### Task 2: Implement the minimal fix

**Files:**
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Add summary extraction for finish persistence**

Persist only the explicit summary section, or the leading non-section prose when no explicit summary heading exists.

- [ ] **Step 2: Tighten changed-file extraction**

Prefer one explicit candidate per bullet/file line so suffix paths are not double-counted.

### Task 3: Record the user-visible contract change

**Files:**
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Update observability contract wording**

Add the finish-card non-duplication expectation to the active observability contract with proof reference.

### Task 4: Verify the fix

**Files:**
- Verify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Verify: `docs/contract-matrix.md`

- [ ] **Step 1: Re-run the targeted runtime test**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='finish_summary|finish card'`
Expected: PASS

- [ ] **Step 2: Run the focused bridge runtime suites**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/persistence-reliability.test.js`
Expected: PASS

- [ ] **Step 3: Run whitespace guard**

Run: `git diff --check`
Expected: No whitespace or patch-format errors.
