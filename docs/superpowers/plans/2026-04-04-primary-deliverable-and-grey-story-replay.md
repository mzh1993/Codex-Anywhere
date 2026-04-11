# Primary Deliverable And Grey Story Replay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make same-origin reply-plane return only the primary user-requested deliverable by default, while turning real grey-story incidents into replayable regression coverage.

**Architecture:** Keep bridge semantics thin. Tighten `codex-exec` guidance so Codex declares a minimal primary deliverable set, not every supporting artifact, and add tests that replay real grey incidents from prompt framing through finish-path delivery. Bridge still only executes the declared manifest and does not infer deliverables itself.

**Tech Stack:** Node.js, `node:test`, Codex bridge prompt/runtime compatibility tests, contract matrix governance docs

---

### Task 1: Add failing replay tests for primary-deliverable semantics

**Files:**
- Modify: `extensions/codex-bridge/test/codex-exec.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing prompt-contract test**

```js
assert.equal(
  prompt.includes("When the user explicitly asks for one primary output, declare only that primary deliverable by default."),
  true,
);
```

- [ ] **Step 2: Write the failing runtime replay test from the real grey story**

```js
assert.equal(nativeEvents.length, 1);
assert.equal(path.basename(nativeEvents[0].filePath), "audio-mainline-architecture.svg");
assert.doesNotMatch(replies[0], /audio-mainline-architecture-notes\.md/);
```

- [ ] **Step 3: Run focused tests to verify RED**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|prompt requires a delivery manifest|primary deliverable'`

Expected: prompt-contract test fails before implementation

### Task 2: Tighten prompt framing without thickening bridge

**Files:**
- Modify: `extensions/codex-bridge/lib/codex-exec.js`

- [ ] **Step 1: Add explicit primary-deliverable guidance**

```js
"When the user explicitly asks for one primary output, declare only that primary deliverable by default.",
"Keep supporting notes or companion docs in `summary` unless the user explicitly asks for them to be returned too.",
```

- [ ] **Step 2: Keep declaration ownership in Codex**

```js
"Do not declare supporting artifacts just because they were created during the task.",
```

- [ ] **Step 3: Re-run focused tests and verify GREEN**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|prompt requires a delivery manifest|primary deliverable'`

Expected: prompt and replay tests pass

### Task 3: Codify grey-story replay and contract wording

**Files:**
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Add primary-deliverable default semantics to the contract**

```md
Reply-plane deliverables default to the minimal user-requested deliverable set; supporting artifacts stay in summary unless explicitly requested.
```

- [ ] **Step 2: Preserve the “story sample -> replay regression” pattern in proof references**

```md
Proof includes runtime replay coverage sourced from real grey incidents.
```

- [ ] **Step 3: Run final verification**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js`

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|prompt requires a delivery manifest|primary deliverable'`

Expected: all targeted tests pass
