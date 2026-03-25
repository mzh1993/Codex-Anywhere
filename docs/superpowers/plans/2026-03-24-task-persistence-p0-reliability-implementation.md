# Task Persistence P0 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the task-state write collision that can crash the bridge after task-start acknowledgement, and ensure persistence failures degrade into explicit recoverable outcomes rather than silent hangs.

**Architecture:** Keep the existing file-based task/run persistence model, but harden it at the two weakest points. First, make temporary file names truly unique for atomic writes. Second, wrap critical runtime persistence writes so a write failure is logged, the task is moved toward an interrupted/recoverable path, and the bridge process does not die on an unhandled rejection.

**Tech Stack:** Node.js, JSON file persistence, existing bridge tests, `node:test`

---

### Task 1: Add failing regression coverage for persistence safety

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-contract.test.js`
- Create: `extensions/codex-bridge/test/persistence-reliability.test.js`

- [ ] **Step 1: Add a failing test that proves temp file names are unique across same-process writes**
- [ ] **Step 2: Add a failing test that simulates a persistence write failure during task execution handling and asserts the task lands in an explicit interrupted/recoverable state rather than silent no-outcome behavior**
- [ ] **Step 3: Run the targeted tests and verify they fail for the right reason**

Run: `npm --prefix extensions/codex-bridge test -- test/runtime-contract.test.js test/persistence-reliability.test.js`
Expected: FAIL showing missing uniqueness / missing controlled failure handling

### Task 2: Make atomic JSON writes collision-safe

**Files:**
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Update `writeJson` to generate a truly unique temp path for each write**
- [ ] **Step 2: Keep the current atomic-write pattern (`writeFile` then `rename`)**
- [ ] **Step 3: Re-run the targeted tests and verify the uniqueness regression turns green**

Run: `npm --prefix extensions/codex-bridge test -- test/persistence-reliability.test.js`
Expected: the temp-path collision regression passes

### Task 3: Add controlled persistence-failure handling around active task writes

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js` if required

- [ ] **Step 1: Identify the active execution persistence paths that currently let write failures escape**
- [ ] **Step 2: Wrap those writes so failures are logged and converted into a controlled interrupted/recoverable outcome**
- [ ] **Step 3: Ensure the bridge no longer exits because of an unhandled rejection from task/run persistence during execution**
- [ ] **Step 4: Preserve and verify the existing explicit-continue recovery semantics: interrupted runs must end in `awaiting_input` and require explicit continue**

### Task 4: Verify full bridge behavior and restart safety

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/persistence-reliability.test.js`

- [ ] **Step 1: Run the new persistence-focused tests**

Run: `npm --prefix extensions/codex-bridge test -- test/persistence-reliability.test.js`
Expected: PASS

- [ ] **Step 1.5: Confirm the persistence-failure regression proves the interrupted task is recoverable rather than silent**

Run: `npm --prefix extensions/codex-bridge test -- test/persistence-reliability.test.js`
Expected: PASS with assertions covering explicit interrupted/recoverable task state

- [ ] **Step 2: Run the full bridge test suite**

Run: `npm --prefix extensions/codex-bridge test`
Expected: PASS

- [ ] **Step 3: Run syntax validation**

Run: `npm --prefix extensions/codex-bridge run check`
Expected: PASS

- [ ] **Step 4: Re-render config and confirm the service still comes up**

Run: `bash scripts/bootstrap-codex-feishu.sh render-config && bash scripts/bootstrap-codex-feishu.sh gateway-status`
Expected: config renders successfully and gateway port is listening
