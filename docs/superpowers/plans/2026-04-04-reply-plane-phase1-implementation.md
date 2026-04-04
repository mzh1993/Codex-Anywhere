# Reply Plane Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在不增加用户心智、也不把 bridge 做厚的前提下，让 Codex 产出的最终摘要和最终可消费产物默认按当前会话 origin 原路回到飞书。

**Architecture:** 保持 bridge 为“origin 约束执行器”而不是“回传语义决策者”。`codex-exec` 只增加一个最小 manifest 输出约束；`finishTask` 在已有 summary/changed-files/next-steps 提取之后，再解析一个内部 delivery manifest；bridge 只校验 manifest 声明的产物是否合法并按同 origin 发送原生 Feishu 消息。失败时摘要照常回，非法或失败产物 fail closed，不做目录扫描、diff 猜测或额外用户命令面。

**Tech Stack:** Node.js, existing `codex-bridge` runtime, OpenClaw Feishu transport helpers (`sendFileFeishu` / `sendImageFeishu` / `sendMediaFeishu` / `sendMessageFeishu`), Node test runner

---

### Task 1: Freeze the runtime contract in docs

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-reply-plane-origin-manifest-design.md`
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Mark the spec ready for implementation**

Update the spec status from “discussion” to “implementation-ready”, and add the minimal manifest framing that implementation will follow: summary remains the finish-card anchor, deliverables are optional, `note` stays default-off.

- [ ] **Step 2: Activate the contract rows that this patch actually lands**

Convert the reply-plane governance rows that become current behavior in this patch from `future` to `active`, and tighten their proof notes to point at the runtime/test names added below. Keep any still-unimplemented redirect/future extension rows as `future`.

### Task 2: Add the failing tests first

**Files:**
- Modify: `extensions/codex-bridge/test/codex-exec.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/policy.test.js`

- [ ] **Step 1: Add prompt-contract failing tests**

Add a `codex-exec` test that expects the built prompt to instruct Codex to emit only a final `delivery manifest` for summary and final deliverables, without adding target-address semantics.

- [ ] **Step 2: Add finish-path failing tests for same-origin delivery**

Add runtime tests that set up a running task, persist a `last-message.txt` containing summary plus a manifest, and assert:

```text
- finish card stays the concise result anchor
- deliverables are not duplicated into the finish card
- valid declared deliverables are sent as native same-origin Feishu messages
- summary still returns when one deliverable fails
```

- [ ] **Step 3: Add fail-closed boundary tests**

Add runtime/policy tests that prove these declared deliverables are skipped:

```text
- absolute path
- ../ path escape
- symlink escape outside cwd
- missing file
- kind/path mismatch
```

Expected: summary still returns, only legal deliverables are sent, and the user-visible failure hint stays aggregated and short.

### Task 3: Implement manifest parsing and validation

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Create: `extensions/codex-bridge/lib/reply-plane.js`

- [ ] **Step 1: Extract reply-plane helpers**

Create a focused helper module that owns:

```js
parseDeliveryManifest(text)
validateDeclaredDeliverables({ cwd, deliverables })
summarizeDeliveryFailures(failures, locale)
```

Keep it narrow:

```text
- accept only summary / deliverables[] / optional note
- kinds: file, image, audio, video, link
- local paths must be relative to cwd
- reject absolute paths, .. traversal, and symlink escapes
- no workspace scan, no diff inference, no semantic guessing
```

- [ ] **Step 2: Wire finishTask to parse the manifest**

In `finishTask`, after reading `last-message.txt`, continue extracting summary/changed-files/next-steps for the finish card, then parse the internal delivery manifest from the same final message and persist the validated delivery result for this run/task.

- [ ] **Step 3: Keep presentation low-noise**

Ensure the finish card stays unchanged except for an optional aggregated failure hint when any declared deliverable cannot be returned. Do not add deliverable counts or echo filenames/URLs into the result card by default.

### Task 4: Implement same-origin native delivery

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`

- [ ] **Step 1: Add minimal delivery persistence**

Extend task/run persistence to store only the delivery facts that matter for continuity and audit:

```text
- validated deliverables returned this round
- aggregated delivery failures
```

Do not persist transport-owned message bodies or create a new delivery state machine.

- [ ] **Step 2: Add a native Feishu delivery executor**

Implement a small bridge helper that sends declared deliverables to the same origin already bound to the task:

```text
- same accountId
- same conversationId
- same thread/reply anchor behavior as the finish card path already uses
```

Use existing OpenClaw Feishu helpers for:

```text
- file/image/audio/video local uploads
- plain-text reply for link (and optional note when allowed)
```

- [ ] **Step 3: Fail closed without blocking summary**

Run delivery after the finish-card update path has succeeded. If individual deliverables fail, continue sending the rest, collect minimal aggregated failures, and never suppress the summary result.

### Task 5: Verify the closed loop

**Files:**
- Verify: `extensions/codex-bridge/lib/reply-plane.js`
- Verify: `extensions/codex-bridge/lib/codex-exec.js`
- Verify: `extensions/codex-bridge/index.js`
- Verify: `extensions/codex-bridge/lib/task-store.js`
- Verify: `extensions/codex-bridge/test/codex-exec.test.js`
- Verify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Verify: `extensions/codex-bridge/test/policy.test.js`
- Verify: `docs/superpowers/specs/2026-04-04-reply-plane-origin-manifest-design.md`
- Verify: `docs/contract-matrix.md`

- [ ] **Step 1: Run the new focused tests red, then green**

Run:

```bash
node --test extensions/codex-bridge/test/codex-exec.test.js --test-name-pattern='reply_plane|delivery manifest'
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|same-origin|deliverable|manifest'
node --test extensions/codex-bridge/test/policy.test.js --test-name-pattern='reply_plane|deliverable'
```

Expected:

```text
Before implementation: new tests fail for the missing behavior.
After implementation: all targeted tests pass.
```

- [ ] **Step 2: Run the wider regression slice**

Run:

```bash
node --test extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/policy.test.js extensions/codex-bridge/test/persistence-reliability.test.js
```

Expected: pass with no new regressions in existing summary/continuity behavior.

- [ ] **Step 3: Run patch hygiene**

Run:

```bash
git diff --check
git diff -- docs/contract-matrix.md docs/superpowers/specs/2026-04-04-reply-plane-origin-manifest-design.md extensions/codex-bridge/lib/codex-exec.js extensions/codex-bridge/lib/reply-plane.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/index.js extensions/codex-bridge/test/codex-exec.test.js extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/policy.test.js
```

Expected: only the reply-plane Phase 1 scope appears, with no accidental command-surface or continuity drift.
