# Open-Source Release Prep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prepare the repository for a first public GitHub alpha release with honest positioning, reduced local-host leakage, and public-facing roadmap/security docs.

**Architecture:** Keep runtime behavior unchanged. Focus this pass on public documentation and release posture: clean repo-facing paths, add explicit alpha and non-production messaging, introduce a concise security model, and publish a roadmap that matches the execution-core-first product direction.

**Tech Stack:** Markdown docs, shell verification with `rg`, existing bridge tests

---

### Task 1: Reframe the README for public release

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Write the failing release-prep checklist in notes before editing**
- [ ] **Step 2: Replace machine-specific public path examples with repo-relative or variable-based examples**
- [ ] **Step 3: Add explicit alpha / not-production-ready positioning**
- [ ] **Step 4: Add a concise non-goals / limits section if missing**
- [ ] **Step 5: Re-read `README.md` top-to-bottom and confirm it matches the current product definition**

### Task 2: Add public security and roadmap documents

**Files:**
- Create: `SECURITY_MODEL.md`
- Create: `ROADMAP.md`

- [ ] **Step 1: Draft `SECURITY_MODEL.md` with current guarantees, boundaries, and known gaps**
- [ ] **Step 2: Draft `ROADMAP.md` with `Now`, `Next`, and `Later` sections**
- [ ] **Step 3: Confirm both documents align with the safe-execution-core-first product definition**
- [ ] **Step 4: Re-read both docs for overclaiming or vague wording**

### Task 3: Clean operator-facing public protocol docs

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Replace public-facing absolute paths with repo-relative or variable-based forms**
- [ ] **Step 2: Keep protocol semantics accurate to the current bridge behavior**
- [ ] **Step 3: Add or keep explicit alpha-appropriate wording where needed**
- [ ] **Step 4: Re-read for clarity from an external operator’s perspective**

### Task 4: Run open-source readiness verification

**Files:**
- Modify: `README.md`
- Modify: `docs/feishu-codex-runner-v1.md`
- Create: `SECURITY_MODEL.md`
- Create: `ROADMAP.md`

- [ ] **Step 1: Search public docs for remaining `/mnt/` and `/home/neousys` leakage**

Run: `rg -n "/mnt/|/home/neousys" README.md ROADMAP.md SECURITY_MODEL.md docs/feishu-codex-runner-v1.md`
Expected: no hits, or only explicitly intentional/local-research cases outside those public docs

- [ ] **Step 2: Run bridge tests**

Run: `npm --prefix extensions/codex-bridge test`
Expected: PASS

- [ ] **Step 3: Run syntax check**

Run: `npm --prefix extensions/codex-bridge run check`
Expected: PASS

- [ ] **Step 4: Run config render validation**

Run: `bash scripts/bootstrap-codex-feishu.sh render-config`
Expected: PASS
