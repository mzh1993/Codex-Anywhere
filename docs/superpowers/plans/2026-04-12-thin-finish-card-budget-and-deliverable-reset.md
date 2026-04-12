# Thin Finish-Card Budget And Deliverable Reset Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make reply-plane delivery state run-scoped and keep finish cards stable by preserving `summary` plus a minimal `next step` without giving the bridge new semantic authority.

**Architecture:** Keep the bridge thin. Fix the stale deliverable problem by clearing reply-plane state when a new run starts, then add a mechanical finish-card budget at the locale presentation layer so the bridge only enforces field order, length limits, and count limits. Record the behavior in the contract matrix and prove it with runtime-compatible regression tests.

**Tech Stack:** Node.js ESM, built-in `node:test`, bridge runtime/persistence modules, Markdown contract docs

---

### Task 1: Lock the regressions with failing tests first

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `docs/contract-matrix.md`

- [ ] **Step 1: Add a failing runtime test for stale deliverables leaking into a new run**

Add a test near the existing reply-plane continuity coverage in `extensions/codex-bridge/test/runtime-compatibility.test.js` that starts a new run from an existing task carrying stale deliverables and proves the new run resets them:

```js
test("runtime/protocol/reply_plane: starting a new run clears stale deliverables and delivery failure hints", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bridge-reply-plane-reset-"));
  const { bridge } = await createBridgeHarness(tempRoot);
  const existingTask = createTaskRecord({
    taskId: "task-stale-deliverables",
    locale: "zh-CN",
    senderId: "user-1",
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-old",
    cwd: tempRoot,
    mode: "resume",
    status: "awaiting_input",
    lastRunId: "run-old",
    prompt: "旧任务",
    createdAt: "2026-04-12T00:00:00.000Z",
    updatedAt: "2026-04-12T00:00:00.000Z",
    deliverables: [{ kind: "file", path: "reports/old-notes.md", url: "", note: "" }],
    deliveryFailureHint: "1 个产物未回传：上传失败",
  });
  const profile = { senderId: "user-1", defaultCwd: tempRoot, updatedAt: "2026-04-12T00:00:00.000Z" };

  await bridge.startTask({
    profile,
    existingTask,
    accountId: "default",
    conversationId: "conv-1",
    messageId: "msg-new",
    prompt: "继续推进",
    mode: "resume",
    cwd: tempRoot,
    runtimeCheck: { ok: true, message: "ok" },
  });

  const persistedTask = await bridge.readTask(existingTask.taskId);
  const persistedRun = await bridge.readRun(persistedTask.currentRunId);
  assert.deepEqual(persistedTask.deliverables, []);
  assert.equal(persistedTask.deliveryFailureHint, null);
  assert.deepEqual(persistedRun.deliverables, []);
  assert.equal(persistedRun.deliveryFailureHint, null);
});
```

- [ ] **Step 2: Add a failing presentation test for finish-card budget stability**

Add a focused test in `extensions/codex-bridge/test/task-model.test.js` that proves `taskFinished` keeps `summary`, keeps only one `next step`, and omits lower-priority tails once the budget is applied:

```js
assert.match(
  text.taskFinished({
    taskId: "task-1",
    status: "awaiting_input",
    cwd: "/workspace",
    sessionId: "session-1",
    summary: "A".repeat(1200),
    changedFiles: ["a.md", "b.md"],
    nextSteps: ["先看图", "再看说明", "最后补验证"],
    deliveryFailureHint: null,
    error: null,
  }),
  /下一步：\n- 先看图/,
);
assert.doesNotMatch(
  text.taskFinished({
    taskId: "task-1",
    status: "awaiting_input",
    cwd: "/workspace",
    sessionId: "session-1",
    summary: "A".repeat(1200),
    changedFiles: ["a.md", "b.md"],
    nextSteps: ["先看图", "再看说明", "最后补验证"],
    deliveryFailureHint: null,
    error: null,
  }),
  /再看说明|最后补验证/,
);
```

- [ ] **Step 3: Run the targeted tests and verify RED**

Run:

```bash
node --test extensions/codex-bridge/test/task-model.test.js
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|starting a new run clears stale deliverables'
```

Expected:

- the new stale-deliverable test fails because `deliverables` are still inherited
- the new finish-card budget test fails because `taskFinished` still emits all `nextSteps`

### Task 2: Implement run-scoped deliverable reset with the smallest possible change

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Reset reply-plane state when starting a fresh run**

In `extensions/codex-bridge/index.js`, extend the `createTaskRecord` / `createRunRecord` payloads inside `startTask()` so a new run always starts from empty reply-plane state:

```js
const task = createTaskRecord({
  ...params.existingTask,
  // existing fields...
  summary: null,
  changedFiles: [],
  nextSteps: [],
  deliverables: [],
  deliveryFailureHint: null,
  error: null,
});

const run = createRunRecord({
  // existing fields...
  summary: null,
  changedFiles: [],
  nextSteps: [],
  deliverables: [],
  deliveryFailureHint: null,
  error: null,
});
```

- [ ] **Step 2: Keep task-store defaults aligned with the new reset semantics**

Confirm `extensions/codex-bridge/lib/task-store.js` still treats missing reply-plane state as empty/null and keep the run/task constructors explicit:

```js
deliverables: input.deliverables ?? [],
deliveryFailureHint: input.deliveryFailureHint ?? null,
```

If any helper path bypasses `startTask()` and would preserve stale values, patch that path too instead of layering a cleanup later.

- [ ] **Step 3: Run the stale-deliverable test and verify GREEN**

Run:

```bash
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='starting a new run clears stale deliverables'
```

Expected:

- PASS

- [ ] **Step 4: Commit the run-scoped reset**

```bash
git add extensions/codex-bridge/index.js extensions/codex-bridge/lib/task-store.js extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "fix: reset reply-plane state for each run"
```

### Task 3: Add a mechanical finish-card budget without semantic interpretation

**Files:**
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Add a tiny helper for summary truncation and next-step limiting**

In `extensions/codex-bridge/lib/locale.js`, add constants and helpers that do only mechanical shaping:

```js
const FINISH_CARD_SUMMARY_MAX_CHARS = 700;
const FINISH_CARD_MAX_NEXT_STEPS = 1;

function truncateFinishCardSummary(text) {
  const normalized = normalizeText(text);
  if (!normalized) return "";
  if (normalized.length <= FINISH_CARD_SUMMARY_MAX_CHARS) return normalized;
  return `${normalized.slice(0, FINISH_CARD_SUMMARY_MAX_CHARS - 1)}…`;
}
```

- [ ] **Step 2: Apply the helper inside both zh/en `taskFinished` formatters**

Update both `taskFinished` implementations so they preserve field order but enforce a fixed budget:

```js
if (task.summary) {
  lines.push("");
  lines.push(truncateFinishCardSummary(task.summary));
}
if (task.nextSteps.length > 0) {
  lines.push("");
  lines.push("下一步：");
  for (const step of task.nextSteps.slice(0, FINISH_CARD_MAX_NEXT_STEPS)) lines.push(`- ${step}`);
}
```

Keep these boundaries:

- do not rewrite `summary`
- do not rank `nextSteps`
- do not reintroduce `changedFiles` when native deliverables are present

- [ ] **Step 3: Add a runtime-level finish-card assertion**

In `extensions/codex-bridge/test/runtime-compatibility.test.js`, add a finish-path test that drives `finishTask()` with a long summary and multiple next steps, then asserts the final card still contains:

```js
assert.match(replies[0], /Summary|摘要/);
assert.match(replies[0], /下一步：|Next:/);
assert.doesNotMatch(replies[0], /第二条下一步|third next step/);
```

- [ ] **Step 4: Run presentation tests and verify GREEN**

Run:

```bash
node --test extensions/codex-bridge/test/task-model.test.js
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='finish_summary|task_finished|starting a new run clears stale deliverables'
```

Expected:

- PASS

- [ ] **Step 5: Commit the finish-card budget**

```bash
git add extensions/codex-bridge/lib/locale.js extensions/codex-bridge/test/task-model.test.js extensions/codex-bridge/test/runtime-compatibility.test.js
git commit -m "fix: stabilize finish-card summary and next step budget"
```

### Task 4: Record the contract and run full verification

**Files:**
- Modify: `docs/contract-matrix.md`
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `docs/experience-regression-checklist.md`
- Verify: `scripts/review/check-contract-matrix.sh`
- Verify: `scripts/review/run-experience-regression.sh`

- [ ] **Step 1: Extend the contract matrix for run-scoped deliverables and finish-card budget**

Add wording to `docs/contract-matrix.md` that keeps this firmly in persistence/presentation semantics:

```md
Reply-plane deliverables are run-scoped and must not leak across later runs on the same task lane.
Finish cards may apply a fixed presentation budget, but only through field order, truncation, and count limits — not semantic rewriting.
```

- [ ] **Step 2: Update the V1 doc to explain the thin-budget rule**

In `docs/feishu-codex-bridge-v1.md`, add one concise note in the reply-plane / observability area:

```md
完成卡只做固定预算整形：保 `summary`、保最小 `next step`，不做语义裁剪。
```

- [ ] **Step 3: Add the regression item to the checklist**

In `docs/experience-regression-checklist.md`, add bullets such as:

```md
- [ ] 新 run 不继承上一轮 reply-plane deliverables / deliveryFailureHint。
- [ ] 完成卡长摘要下仍保留 summary 和 1 条 next step。
```

- [ ] **Step 4: Run the full verification set**

Run:

```bash
node --test extensions/codex-bridge/test/task-model.test.js
node --test extensions/codex-bridge/test/runtime-compatibility.test.js
node --test extensions/codex-bridge/test/runtime-contract.test.js
scripts/review/check-contract-matrix.sh origin/main...HEAD
scripts/review/run-experience-regression.sh
git diff --check
```

Expected:

- all tests PASS
- contract guard reports matrix alignment
- experience regression completes successfully
- `git diff --check` prints no patch errors

- [ ] **Step 5: Commit the contract and verification pass**

```bash
git add docs/contract-matrix.md docs/feishu-codex-bridge-v1.md docs/experience-regression-checklist.md
git commit -m "docs: codify thin finish-card budget semantics"
```

## Self-Review

- **Spec coverage:** The plan maps both approved fixes from the spec: Task 2 covers run-scoped deliverable reset; Task 3 covers fixed-budget finish cards; Task 4 records the behavior as persistence/presentation semantics rather than new bridge authority.
- **Placeholder scan:** No `TODO` / `TBD` / “handle appropriately” placeholders remain; every code-changing step includes concrete snippets and exact commands.
- **Type consistency:** Uses existing names from the codebase: `deliverables`, `deliveryFailureHint`, `taskFinished`, `createTaskRecord`, `createRunRecord`, `finishTask`, `runtime-compatibility.test.js`.
