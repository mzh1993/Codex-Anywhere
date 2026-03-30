# Reset Tail Suppression Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure an upstream reset abandons the old execution lane so its eventual exit cannot pollute the user-visible lane or overwrite the new lane's profile continuity.

**Architecture:** Keep the bridge thin. Reuse the existing reset-abandoned marker, and only gate finish-time side effects for that abandoned lane. Preserve persistence/audit of the old run, but suppress user-facing completion reply and profile continuity writes.

**Tech Stack:** Node.js, built-in `node:test`, existing `codex-bridge` task/profile persistence.

---

### Task 1: Add failing regression coverage

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Write the failing test**
- [ ] **Step 2: Run only the new reset-tail test and verify it fails for the expected reason**
- [ ] **Step 3: Implement the minimal finish-time suppression logic**
- [ ] **Step 4: Re-run the reset-tail test and verify it passes**
- [ ] **Step 5: Re-run targeted bridge routing/runtime tests to verify no regressions**
