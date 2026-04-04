# Feishu Closed-Loop Top-Level Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the top-level docs and governance docs to the newly agreed Feishu closed-loop north star without changing runtime behavior.

**Architecture:** Update the long-term direction in `product-north-star.md`, translate that direction into hard product-boundary rules in `product-decision-baseline.md`, move the phase sequencing into `roadmap.md`, and reflect the behavior-governance change in `docs/contract-matrix.md`.

**Tech Stack:** Markdown docs, repository governance docs, contract-matrix review gate

---

### Task 1: Record the design and plan context

**Files:**
- Create: `docs/superpowers/specs/2026-04-04-feishu-closed-loop-top-level-alignment-design.md`
- Create: `docs/superpowers/plans/2026-04-04-feishu-closed-loop-top-level-alignment.md`

- [ ] **Step 1: Save the design note**

Create the agreed top-level design note summarizing the closed-loop direction, constraints, and non-goals.

- [ ] **Step 2: Save the implementation plan**

Create this implementation plan so the repo keeps a durable record of the intended doc alignment.

### Task 2: Update the top-level three-piece set

**Files:**
- Modify: `docs/product-north-star.md`
- Modify: `docs/product-decision-baseline.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Update the north star**

Replace the one-line north star, refresh the first-principles wording, and add the low-cognitive-load and closed-loop principles.

- [ ] **Step 2: Update the decision baseline**

Add explicit hard rules for Feishu as the primary surface, default return flow to the current Feishu context, and the prohibition against bridge evolving into a Feishu business assistant.

- [ ] **Step 3: Update the roadmap**

Move the current phase framing to feedback-loop closure first, then richer Feishu object collaboration.

### Task 3: Update governance mapping

**Files:**
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Add contract rows**

Record the top-level product-boundary governance changes so future review/test work has an explicit anchor.

### Task 4: Verify the doc change

**Files:**
- Verify: `docs/product-north-star.md`
- Verify: `docs/product-decision-baseline.md`
- Verify: `docs/roadmap.md`
- Verify: `docs/contract-matrix.md`

- [ ] **Step 1: Run diff review**

Run: `git diff -- docs/product-north-star.md docs/product-decision-baseline.md docs/roadmap.md docs/contract-matrix.md docs/superpowers/specs/2026-04-04-feishu-closed-loop-top-level-alignment-design.md docs/superpowers/plans/2026-04-04-feishu-closed-loop-top-level-alignment.md`
Expected: Only the intended top-level alignment and governance-doc additions appear.

- [ ] **Step 2: Run whitespace guard**

Run: `git diff --check`
Expected: No whitespace or patch-format errors.
