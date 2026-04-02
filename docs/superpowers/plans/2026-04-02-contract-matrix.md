# Contract Matrix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Institutionalize a development-time contract matrix that translates top-level product constraints into explicit, test-mapped obligations without thickening the runtime bridge.

**Architecture:** Add one stable matrix document as the executable contract layer between top-level principles and tests, then wire it into repo docs and review discipline. Keep all changes in documentation and development workflow unless a later contract row exposes a real runtime gap.

**Tech Stack:** Markdown docs, repo review workflow, built-in bridge test suite (`node:test`)

---

### Task 1: Create The Contract Matrix Source Of Truth

**Files:**
- Create: `docs/contract-matrix.md`
- Reference: `docs/product-north-star.md`
- Reference: `docs/product-decision-baseline.md`
- Reference: `docs/feishu-codex-bridge-v1.md`

- [ ] **Step 1: Draft the matrix file header and hard boundary**

Write the opening section that states:

- this is a development-time governance artifact
- it is not a runtime policy engine
- it does not authorize new user-visible command surface

- [ ] **Step 2: Define the fixed matrix schema**

Document the required fields for every contract row:

```md
| contract_id | top_level_source | rule | visible_to_user | platform | required_tests | notes |
```

- [ ] **Step 3: Seed the first four highest-risk sections**

Add initial rows for:

- product boundary
- continuity
- observability
- command surface

Use current known high-risk rules such as:

- ordinary text remains Codex-owned
- restart continuity keeps the same task lane
- same-run card reuse vs. cross-run fresh card creation
- `/codex doctor` remains the only long-lived bridge command

- [ ] **Step 4: Validate the rows are actually testable**

Re-read each seeded row and verify it answers:

1. what triggers the rule
2. what outcome must happen
3. whether it is user-visible, internal, or both
4. which platform scope applies
5. which test family proves it

- [ ] **Step 5: Commit the matrix file**

```bash
git add docs/contract-matrix.md
git commit -m "docs: add contract matrix"
```

### Task 2: Wire The Matrix Into Repository Guidance

**Files:**
- Modify: `README.md`
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `AGENTS.md`

- [ ] **Step 1: Add the matrix to the README reading order**

Update the “继续阅读” / repo positioning sections so contributors see `docs/contract-matrix.md` as a first-class governance artifact.

- [ ] **Step 2: Add a V1 protocol note that behavior-changing work must update the matrix**

In `docs/feishu-codex-bridge-v1.md`, add a short maintenance note near the protocol/behavior sections:

- top-level behavior changes must be mirrored in the contract matrix
- contract rows must stay mapped to tests

- [ ] **Step 3: Add repo-agent guidance for future work**

Update `AGENTS.md` with a short rule:

- when behavior meaning changes in boundary/continuity/observability/command surface/cross-platform semantics, update the contract matrix in the same change

- [ ] **Step 4: Review for “thin bridge” alignment**

Check that none of these repo guidance edits imply:

- runtime contract evaluation
- new bridge commands
- thicker ordinary-text interpretation

- [ ] **Step 5: Commit the guidance wiring**

```bash
git add README.md docs/feishu-codex-bridge-v1.md AGENTS.md
git commit -m "docs: wire contract matrix into repo guidance"
```

### Task 3: Backfill Initial Test Mapping Discipline

**Files:**
- Modify: `docs/contract-matrix.md`
- Reference: `extensions/codex-bridge/test/policy.test.js`
- Reference: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Reference: `extensions/codex-bridge/test/persistence-reliability.test.js`
- Reference: `extensions/codex-bridge/test/runtime-control-plane.test.js`

- [ ] **Step 1: Map each seeded contract row to at least one current test family**

For each initial contract row, add the proving test family:

- `policy`
- `routing`
- `persistence`
- `presentation`
- `continuity`
- `runtime_compat`

- [ ] **Step 2: Mark known proof gaps explicitly**

If a contract has no strong proof yet, record that as an explicit gap in the matrix instead of leaving the row vague.

- [ ] **Step 3: Add one “user-visible vs internal-state” note for each risky contract**

Examples:

- continuity rows usually require `both`
- permission rows may be `internal-state` plus visible approval UX
- observability rows are almost always `user-visible` or `both`

- [ ] **Step 4: Verify the matrix does not silently bless Linux-only assumptions**

For each seeded row, mark one of:

- `cross-platform`
- `allowed-diff`
- `linux-only`
- `windows-only`

No row should leave platform scope implicit.

- [ ] **Step 5: Commit the first mapped matrix**

```bash
git add docs/contract-matrix.md
git commit -m "docs: map initial contracts to bridge test families"
```

### Task 4: Add Review-Time Gatekeeping

**Files:**
- Modify: `AGENTS.md`
- Modify: `README.md`
- Optional Modify: `.github/PULL_REQUEST_TEMPLATE.md`

- [ ] **Step 1: Decide the lightest review gate already supported by this repo**

Prefer repo-local guidance first:

- `AGENTS.md`
- contributor docs
- optional PR template only if one already fits the repo workflow

- [ ] **Step 2: Add a minimal checklist line, not a new process framework**

The checklist should ask:

- did behavior meaning change?
- if yes, was `docs/contract-matrix.md` updated?
- were user-visible and internal-state proofs both considered where needed?

- [ ] **Step 3: Keep the review gate lightweight**

Verify the checklist does not create:

- a second product surface
- a runtime dependency
- mandatory bureaucracy for unrelated edits

- [ ] **Step 4: Commit the review gate**

```bash
git add AGENTS.md README.md .github/PULL_REQUEST_TEMPLATE.md
git commit -m "docs: add contract matrix review gate"
```

### Task 5: Verify The Institutional Path

**Files:**
- Verify: `docs/contract-matrix.md`
- Verify: `README.md`
- Verify: `docs/feishu-codex-bridge-v1.md`
- Verify: `AGENTS.md`

- [ ] **Step 1: Run a focused grep review for matrix references**

Run:

```bash
rg -n "contract matrix|docs/contract-matrix.md" README.md docs/feishu-codex-bridge-v1.md AGENTS.md docs/contract-matrix.md
```

Expected: the matrix is referenced from contributor-facing guidance and protocol guidance.

- [ ] **Step 2: Re-read the matrix against the hard boundary**

Confirm the final docs still say, in substance:

- development-time governance only
- not runtime behavior
- no thicker bridge semantics

- [ ] **Step 3: Run full bridge tests to ensure no accidental code-path edits slipped in**

Run:

```bash
node --test extensions/codex-bridge/test/*.test.js
```

Expected: all tests pass.

- [ ] **Step 4: Summarize known remaining gaps**

Record which sections still need future backfill:

- permission boundary matrix depth
- cross-platform “allowed-diff” rows
- any uncovered user-visible contracts
