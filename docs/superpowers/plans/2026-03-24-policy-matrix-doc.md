# Policy Matrix Doc Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Document the current V1 controlled-execution policy matrix in a way that matches the implemented behavior.

**Architecture:** Keep the product explanation in `docs/feishu-codex-runner-v1.md`, because that file already defines the runtime protocol. Add a compact matrix that maps action type and target zone to allow / approval / deny, with explicit notes that V1 currently uses `cwd` as the controlled root.

**Tech Stack:** Markdown docs.

---

### Task 1: Add minimal policy matrix

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Insert a compact matrix under risk control**
- [ ] **Step 2: Align wording with implemented policy behavior**
- [ ] **Step 3: Keep product language concise and operator-friendly**
