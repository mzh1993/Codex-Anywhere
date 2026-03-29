# P0 Explicit Start Gate And Doctor Implementation Plan

> **For agentic workers:** Repository `AGENTS.md` overrides the default superpowers execution handoff here. Implement this plan inline in the main session, sequentially, and keep the scope limited to the files below. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make high-risk bridge intervention happen only on explicit `/codex` start surfaces, and make `/codex doctor` a trustworthy runtime health summary for this isolated Feishu bridge.

**Architecture:** Keep the current product boundary intact: plain text remains Codex-first, and bridge only intervenes on explicit start/resume or its own approval/control-plane loops. Split “execution boundary preflight” from ordinary prompt semantics so protected-root and dangerous-start gates are evaluated only on explicit start lanes, then upgrade doctor to report real runtime health instead of a minimal heartbeat-only summary.

**Tech Stack:** Node.js ESM, OpenClaw plugin entry, Codex CLI, `node --test`, existing bridge persistence/runtime helpers.

---

### Task 1: Freeze The Explicit-Start Gate Contract

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `docs/product-decision-baseline.md`
- Modify: `docs/roadmap.md`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing doc-adjacent regression tests**

Add tests that prove:
- plain text mentioning `~/.openclaw`, `~/.codex`, model names, or reasoning words does not trigger bridge-owned start gating by itself
- explicit `/codex --cd ~/.openclaw ...` still triggers approval
- explicit dangerous start flags are rejected or approval-gated only on the explicit `/codex` lane

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: FAIL on the new explicit-start-only gate assertions.

- [ ] **Step 2: Tighten the contract text**

Update the docs so they say, explicitly and consistently:
- protected-root / host-boundary startup approval is a start-lane gate, not ordinary plain-text semantics
- plain text continues to belong to Codex unless the bridge already owns the current approval/control-plane loop
- doctor is expected to summarize real runtime readiness, not just a generic “ok/error”

- [ ] **Step 3: Re-run the same focused test**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js`
Expected: still FAIL, because docs are updated but code has not been changed yet.


### Task 2: Split Explicit Start Gating From Plain-Text Codex Routing

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/policy.js`
- Modify: `extensions/codex-bridge/lib/task-model.js` (only if a lane/owner helper must be clarified)
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Write one more failing routing test for lane ownership**

Add a focused routing test proving:
- ordinary plain text that discusses protected roots still stays on the Codex lane
- explicit `/codex` start is the only place where start-boundary gating is allowed to preempt startup

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/routing.test.js`
Expected: FAIL on the new lane split assertion.

- [ ] **Step 2: Add an explicit entry-surface discriminator**

In `extensions/codex-bridge/index.js`, pass a narrow entry marker through task startup, for example:

```js
entrySurface: "plain_text" | "explicit_codex_command" | "approval_granted_run"
```

Use it only to decide whether bridge-owned startup gating is allowed before execution.

- [ ] **Step 3: Apply the minimal implementation**

Implement the split so that:
- ordinary plain text continues to create/continue a Codex task without bridge preempting startup based on protected-root prompt semantics
- explicit `/codex ...` startup still applies cwd / explicit-start boundary review
- approval-granted runs keep their current start-time verification semantics

Do not add new command verbs.
Do not add more natural-language interpretation.
Do not broaden bridge action ownership.

- [ ] **Step 4: Run the focused regression tests**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/routing.test.js`
Expected: PASS.


### Task 3: Make `/codex doctor` A Trustworthy Runtime Summary

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/runtime-compatibility.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/runtime-contract.test.js`
- Optional modify: `README.md`

- [ ] **Step 1: Write failing doctor tests first**

Add tests that prove doctor reports:
- Codex runtime readiness
- `bwrap` compatibility readiness
- gateway reachability
- isolated Feishu secret/runtime readiness in a user-facing summary line

Keep the output short. The test should reject a vague three-line summary if it does not surface concrete runtime state.

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js`
Expected: FAIL on the new doctor assertions.

- [ ] **Step 2: Extend runtime compatibility output shape**

Add the smallest useful structured fields to `detectExecutionRuntimeCompatibility()`, for example:

```js
{
  ok,
  codexVersion,
  bwrapVersion,
  reasonCode,
  message
}
```

If needed, add a companion helper for isolated secret/runtime readiness, but keep it read-only and fail-closed.

- [ ] **Step 3: Upgrade doctor formatting**

Update `formatDoctor()` so it combines:
- current Codex task state
- bridge control-plane state
- runtime compatibility state
- gateway/Feishu readiness
- one concrete next step when unhealthy

Keep the summary compact and deterministic.

- [ ] **Step 4: Run the doctor-focused tests**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js`
Expected: PASS.


### Task 4: Full Regression And Release Check

**Files:**
- Verify only: `extensions/codex-bridge/`
- Verify only: touched docs above

- [ ] **Step 1: Run the bridge test suite**

Run: `npm --prefix extensions/codex-bridge test`
Expected: PASS with `0 fail`.

- [ ] **Step 2: Run syntax verification**

Run: `npm --prefix extensions/codex-bridge run check`
Expected: PASS.

- [ ] **Step 3: Re-read the touched docs against the new behavior**

Manually verify that these files all agree on the same story:
- `README.md`
- `docs/feishu-codex-bridge-v1.md`
- `docs/product-decision-baseline.md`
- `docs/roadmap.md`

Check for these exact points:
- explicit `/codex` start is the start gate
- plain text stays Codex-first
- `--cd` / `--model` / `--reasoning` remain the only explicit start parameters
- doctor is described as a real health summary

- [ ] **Step 4: Capture the release-close evidence**

Record the exact commands and results in the handoff:
- `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/routing.test.js extensions/codex-bridge/test/runtime-contract.test.js`
- `npm --prefix extensions/codex-bridge test`
- `npm --prefix extensions/codex-bridge run check`


### Non-Goals

- [ ] Do not introduce `acpx` in this round.
- [ ] Do not add new bridge user-visible commands.
- [ ] Do not expand bridge natural-language judgment.
- [ ] Do not redesign channels, pairing, or persistence layout.
- [ ] Do not refactor unrelated OpenClaw bootstrap/runtime code beyond what doctor needs to read.
