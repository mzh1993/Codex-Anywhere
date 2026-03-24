# Codex Anywhere Public Packaging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Align the repository’s public identity with `Codex Anywhere` and add the minimum community packaging needed for a first public GitHub alpha release.

**Architecture:** Keep runtime behavior unchanged. This pass updates repository-facing documentation and collaboration surfaces so the project leads with borderless collaboration, keeps safe-execution-core semantics explicit, and gives contributors a clean way to report bugs, propose features, and submit changes.

**Tech Stack:** Markdown docs, GitHub repository metadata conventions, existing verification commands

---

### Task 1: Rebrand the public entrypoint

**Files:**
- Modify: `README.md`
- Create: `.github/repository-metadata.md`

- [ ] **Step 1: Update the title and opening positioning to `Codex Anywhere`**
- [ ] **Step 2: Keep the alpha / developer-preview posture explicit**
- [ ] **Step 3: Present the product value as borderless collaboration with safe execution semantics**
- [ ] **Step 4: Keep Feishu and OpenClaw framed as current implementation choices**
- [ ] **Step 5: Add `.github/repository-metadata.md` with the recommended GitHub About text and topic set**
- [ ] **Step 6: Re-read the README opening and metadata note to confirm they sell the right product without overclaiming**

### Task 2: Add contributor and security entrypoints

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`

- [ ] **Step 1: Write `CONTRIBUTING.md` with repo scope, preferred contribution flow, architecture-first contribution guidance, and an explicit prompt to call out execution, approval, and recovery semantic impact**
- [ ] **Step 2: Write `SECURITY.md` with a private reporting path and a short boundary-aware disclosure policy**
- [ ] **Step 3: Ensure both docs use normal engineering language rather than AI-marketing language**
- [ ] **Step 4: Re-read both docs for honesty, clarity, and collaborator usefulness**

### Task 3: Add GitHub issue and PR templates

**Files:**
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Add a bug template that captures reproduction steps, environment, expected behavior, and observed behavior**
- [ ] **Step 2: Add a feature template that asks whether the request changes the execution core or only a control-plane/transport surface, and what it would change about execution, approval, or recovery semantics**
- [ ] **Step 3: Add a PR template that asks whether task, approval, or recovery semantics are affected**
- [ ] **Step 4: Re-read all templates to keep them short, high-signal, and aligned with the project’s first principles**

### Task 4: Verify public packaging consistency

**Files:**
- Modify: `README.md`
- Create: `.github/repository-metadata.md`
- Create: `CONTRIBUTING.md`
- Create: `SECURITY.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`
- Create: `.github/pull_request_template.md`

- [ ] **Step 1: Search the updated public packaging files for accidental local-host path leakage**

Run: `rg -n "/mnt/|/home/neousys" README.md CONTRIBUTING.md SECURITY.md .github`
Expected: no hits

- [ ] **Step 2: Search the updated public packaging files for `Codex Anywhere` positioning consistency**

Run: `rg -n "Codex Anywhere|borderless|execution semantics|Feishu|OpenClaw" README.md CONTRIBUTING.md SECURITY.md .github`
Expected: the wording appears where intended and does not contradict the current product definition

- [ ] **Step 3: Re-run existing bridge verification to confirm the packaging pass did not disturb the working tree expectations**

Run: `npm --prefix extensions/codex-bridge test && npm --prefix extensions/codex-bridge run check && bash scripts/bootstrap-codex-feishu.sh render-config`
Expected: PASS
