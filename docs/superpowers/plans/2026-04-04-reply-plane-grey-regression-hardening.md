# Reply Plane Grey Regression Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep finish-card delivery transport-safe while still returning declared same-origin outputs, including `.svg` artifacts as files.

**Architecture:** Preserve the thin-bridge model. Normalize only the finish-card markdown that Feishu cannot render safely, keep deliverable return declaration-bound, and downgrade `.svg` image declarations to file delivery instead of introducing bridge-side image conversion.

**Tech Stack:** Node.js, `node:test`, Codex bridge reply-plane/runtime compatibility tests

---

### Task 1: Add grey-regression tests first

**Files:**
- Modify: `extensions/codex-bridge/test/reply-plane.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Write the failing unit test for `.svg` delivery normalization**

```js
const result = await validateDeclaredDeliverables({
  cwd: workspace,
  deliverables: [{ kind: "image", path: "reports/architecture.svg" }],
});

assert.equal(result.accepted[0].kind, "file");
```

- [ ] **Step 2: Write the failing runtime regression for finish-card markdown image stripping**

```js
assert.doesNotMatch(replies[0], /!\[/);
assert.equal(nativeEvents.length, 2);
```

- [ ] **Step 3: Run the focused tests and confirm RED**

Run: `node --test extensions/codex-bridge/test/reply-plane.test.js extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|task lifecycle bridge notices render as lightweight cards'`

Expected: failure on `.svg` downgrade and finish-card markdown-image regression

### Task 2: Implement the minimal thin-bridge fix

**Files:**
- Modify: `extensions/codex-bridge/lib/reply-plane.js`
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Normalize `.svg` image declarations to file delivery**

```js
if (deliverable.kind === "image" && extension === ".svg") {
  accepted.push({ ...deliverable, kind: "file" });
}
```

- [ ] **Step 2: Strip transport-unsafe markdown image embeds from finish-card body**

```js
const markdownText =
  renderHint === "task_finished"
    ? stripCardUnsafeMarkdown(text)
    : text;
```

- [ ] **Step 3: Re-run the focused tests and confirm GREEN**

Run: `node --test extensions/codex-bridge/test/reply-plane.test.js extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|task lifecycle bridge notices render as lightweight cards'`

Expected: all targeted tests pass

### Task 3: Update contract proof and verify final scope

**Files:**
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Update reply-plane contract rows for finish-card safety and `.svg` downgrade semantics**

```md
Finish-card summaries must stay transport-safe.
Vector image manifests degrade to file delivery.
```

- [ ] **Step 2: Run final verification**

Run: `node --test extensions/codex-bridge/test/reply-plane.test.js`

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|finish_summary|presentation: task lifecycle bridge notices render as lightweight cards'`

Expected: pass
