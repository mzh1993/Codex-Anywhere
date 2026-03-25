# P0-1 Controlled Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shift policy evaluation from fragile path/keyword matching toward a minimal controlled-root plus action-tier model.

**Architecture:** Keep the existing `assessPolicyDecision()` API stable, but introduce internal helpers that classify candidate intents into controlled-root, host-outside-root, and protected-root buckets, then combine that with action tiers such as write, service control, global install, and destructive operations. Preserve existing reason codes where possible so the task protocol stays stable.

**Tech Stack:** Node.js, built-in `node:test`, existing bridge policy helpers.

---

### Task 1: Add failing policy tests for controlled-root semantics

**Files:**
- Modify: `extensions/codex-bridge/test/policy.test.js`
- Test: `extensions/codex-bridge/test/policy.test.js`

- [ ] **Step 1: Write failing tests**
- [ ] **Step 2: Run targeted policy tests and confirm failure**
- [ ] **Step 3: Cover controlled root writes, host outside-root writes, and protected root denial**

### Task 2: Implement minimal controlled-root classifier

**Files:**
- Modify: `extensions/codex-bridge/lib/policy.js`
- Test: `extensions/codex-bridge/test/policy.test.js`

- [ ] **Step 1: Add helpers for path extraction and write-intent detection**
- [ ] **Step 2: Add controlled-root based approval/deny routing**
- [ ] **Step 3: Keep service/global/destructive approvals stable**

### Task 3: Verify bridge policy behavior stays stable

**Files:**
- Test: `extensions/codex-bridge/test/policy.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Run targeted policy tests**
- [ ] **Step 2: Run full bridge test suite**
- [ ] **Step 3: Run bridge static checks**
