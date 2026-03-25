# Top-Level Doc Boundary Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the repository’s top-level design documents so they describe product principles and document boundaries clearly, while `docs/feishu-codex-runner-v1.md` becomes the single detailed V1 protocol source.

**Architecture:** Keep the current document set, but re-scope each file to one responsibility: `README.md` for lightweight entry, `docs/product-north-star.md` for product compass, `docs/product-decision-baseline.md` for internal rulings, `docs/roadmap.md` for capability sequencing, and `docs/feishu-codex-runner-v1.md` for current protocol. Remove duplicated or obsolete protocol fragments instead of restating them in multiple places.

**Tech Stack:** Markdown docs, existing repository structure, manual diff review.

---

## Scope

- In scope:
  - tighten top-level doc boundaries
  - remove obsolete or duplicated protocol fragments from top-level docs
  - align north star / baseline / roadmap with the new `codex task` vs `bridge action` model
  - keep only currently valid V1 protocol in `docs/feishu-codex-runner-v1.md`
- Out of scope:
  - runtime code changes
  - protocol redesign beyond wording cleanup
  - public marketing rewrite beyond README boundary cleanup

## File Map

- Modify: `README.md`
  - Reduce to project entry, startup, positioning, and reading path.
- Modify: `docs/product-north-star.md`
  - Add the latest top-level object boundary and control-plane ownership principles.
- Modify: `docs/product-decision-baseline.md`
  - Keep it as the stable internal decision court and remove any residual protocol drift.
- Modify: `docs/roadmap.md`
  - Reflect bridge-owned control-plane capability at capability level only.
- Modify: `docs/feishu-codex-runner-v1.md`
  - Keep only the current valid V1 protocol and remove old competing assumptions.
- Test/Review: `git diff -- README.md docs/product-north-star.md docs/product-decision-baseline.md docs/roadmap.md docs/feishu-codex-runner-v1.md`

### Task 1: Clean top-level entry documents

**Files:**
- Modify: `README.md`
- Modify: `docs/product-north-star.md`

- [ ] **Step 1: Trim `README.md` to lightweight entry responsibilities**
- [ ] **Step 2: Remove detailed command/protocol sections from `README.md`**
- [ ] **Step 3: Keep only one short fallback-command statement if still needed**
- [ ] **Step 4: Update `docs/product-north-star.md` with `codex task` / `bridge action` object boundary**
- [ ] **Step 5: Keep `docs/product-north-star.md` at principle level only**
- [ ] **Step 6: Review the diff for duplicated protocol detail**

### Task 2: Align internal decision documents

**Files:**
- Modify: `docs/product-decision-baseline.md`
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Re-read both files against the new control-plane decisions**
- [ ] **Step 2: Tighten `docs/product-decision-baseline.md` so it remains a decision court, not a protocol reference**
- [ ] **Step 3: Add bridge-owned control-plane capability to `docs/roadmap.md` only at capability level**
- [ ] **Step 4: Remove wording that leaks detailed V1 protocol upward**
- [ ] **Step 5: Review the diff for consistency with `docs/product-north-star.md`**

### Task 3: Make the V1 runner doc the only detailed protocol source

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Re-read the current V1 runner doc and mark obsolete or dual-track protocol wording**
- [ ] **Step 2: Delete rejected protocol assumptions instead of keeping hedge wording**
- [ ] **Step 3: Keep only the currently valid command, approval, recovery, and state rules**
- [ ] **Step 4: Ensure the doc reflects the latest natural-language-first interaction model**
- [ ] **Step 5: Ensure the doc does not describe top-level product strategy**

### Task 4: Final review

**Files:**
- Review: `README.md`
- Review: `docs/product-north-star.md`
- Review: `docs/product-decision-baseline.md`
- Review: `docs/roadmap.md`
- Review: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Run a focused diff review**
  - Run: `git diff -- README.md docs/product-north-star.md docs/product-decision-baseline.md docs/roadmap.md docs/feishu-codex-runner-v1.md`
- [ ] **Step 2: Check that each file now has one clear responsibility**
- [ ] **Step 3: Check that obsolete protocol text is removed rather than restated**
- [ ] **Step 4: Prepare a short handoff summary of what changed in each document**
