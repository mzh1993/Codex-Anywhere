# Top-Level Routing Clarification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a minimal top-level clarification so the baseline and roadmap state a harder routing rule: if bridge ownership is not immediately clear, bridge must not take over.

**Architecture:** Keep the product north star unchanged, append three hard routing prohibitions to `docs/product-decision-baseline.md`, and add a single execution-guidance sentence to `docs/roadmap.md`. This is a documentation-only tightening pass: no new product surface, no new command semantics, no implementation detail expansion.

**Tech Stack:** Markdown docs, existing top-level product documents

---

### Task 1: Patch the baseline with hard routing prohibitions

**Files:**
- Modify: `docs/product-decision-baseline.md`
- Reference: `docs/superpowers/specs/2026-03-29-top-level-routing-clarification-design.md`

- [ ] **Step 1: Add the three new clauses after the current routing/approval clauses**

Insert clauses 31–33 at the end of Chapter 3 so they read as implementation-hardening rules rather than a new conceptual framework.

- [ ] **Step 2: Keep wording short and imperative**

Use the approved language centered on: no semantic guessing, no takeover without a single explicit bridge-owned action, and fallback to `Codex` whenever ownership is not immediately clear.

- [ ] **Step 3: Re-read the surrounding chapter for duplication**

Check that the new clauses reinforce Articles 12–16 without rewriting or contradicting them.

### Task 2: Sync the roadmap with one execution sentence

**Files:**
- Modify: `docs/roadmap.md`

- [ ] **Step 1: Add one sentence to the execution-facing roadmap text**

State that ongoing implementation tightening follows the rule “不够明确，就不接”.

- [ ] **Step 2: Avoid turning roadmap into a second baseline**

Keep the roadmap addition brief and operational; do not duplicate the new clauses verbatim.

### Task 3: Verify doc consistency and hygiene

**Files:**
- Verify only

- [ ] **Step 1: Review the edited docs together**

Run: `sed -n '1,220p' docs/product-decision-baseline.md && printf '\n---\n' && sed -n '1,120p' docs/roadmap.md`
Expected: the new baseline clauses and the roadmap sentence align on the same conservative-routing rule.

- [ ] **Step 2: Check patch hygiene**

Run: `git diff --check && git diff -- docs/product-decision-baseline.md docs/roadmap.md`
Expected: no whitespace issues; only intended top-level doc wording changes.
