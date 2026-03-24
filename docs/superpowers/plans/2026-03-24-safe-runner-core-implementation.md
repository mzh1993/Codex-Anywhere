# Safe Runner Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the current Feishu Codex bridge prototype into an execution-core-first runner by fixing the P0/P1 boundary issues, introducing a stable policy model, and aligning task lifecycle semantics with the approved design.

**Architecture:** Keep `OpenClaw` as the Feishu transport shell, but move execution semantics into explicit runner modules. Split `extensions/codex-bridge/index.js` into focused units for settings, policy, task persistence, runtime spawning, and localized messaging so policy decisions and task status transitions become testable and channel-neutral.

**Tech Stack:** Node.js ESM, OpenClaw plugin entry, Feishu transport via `openclaw-lark`, filesystem JSON state, `node:test`, Bash bootstrap validation

---

## File Structure

### Existing files to modify

- Modify: `extensions/codex-bridge/index.js`
  - Reduce to plugin registration and `CodexBridge` orchestration only.
- Modify: `extensions/codex-bridge/package.json`
  - Add local validation scripts for `node --test` and syntax checks.
- Modify: `docs/feishu-codex-runner-v1.md`
  - Update V1 protocol description to reflect stable task statuses, policy decisions, and explicit continue semantics.
- Modify: `README.md`
  - Update the project positioning and operator-facing behavior summary.

### New runtime modules

- Create: `extensions/codex-bridge/lib/settings.js`
  - Normalize config, paths, protected roots, locale, and allowlisted environment inputs.
- Create: `extensions/codex-bridge/lib/policy.js`
  - Implement `allowed / approval_required / denied` classification and stable reason codes.
- Create: `extensions/codex-bridge/lib/task-model.js`
  - Define stable statuses, terminal-state helpers, active-state helpers, and task event helpers.
- Create: `extensions/codex-bridge/lib/task-store.js`
  - Read/write profile, task, approval, and run-record JSON files.
- Create: `extensions/codex-bridge/lib/codex-exec.js`
  - Build `codex exec` args, env allowlist, and spawn lifecycle helpers.
- Create: `extensions/codex-bridge/lib/locale.js`
  - Map stable statuses and reason codes to localized user text without making locale strings the protocol source of truth.
- Create: `extensions/codex-bridge/lib/fs-utils.js`
  - Shared helpers such as `writeJson`, `readJson`, `appendFile`, and path checks.

### New tests

- Create: `extensions/codex-bridge/test/task-model.test.js`
- Create: `extensions/codex-bridge/test/policy.test.js`
- Create: `extensions/codex-bridge/test/codex-exec.test.js`
- Create: `extensions/codex-bridge/test/routing.test.js`

These tests are justified because the implementation is moving from prompt heuristics to protocol-level behavior and currently has no guardrails for those semantics.

## Implementation Notes

- Keep repository-private state layout under `.isolated/.../codex-bridge/`.
- Do not add `superpowers` as a runtime dependency.
- Preserve `OpenClaw` as transport shell; do not wire the runner core directly into Feishu APIs outside the existing plugin entry.
- Prefer extracting modules from `index.js` over large in-place rewrites so the core model becomes directly testable.
- Treat stable reason codes and stable task statuses as protocol values; localized strings must derive from them.
- Tasks 1–3 are already complete in the working tree. The remaining work starts from the revised task/run split model and supersedes the older one-task/one-run assumptions.

### Task 1: Establish the task model and test harness

**Files:**
- Create: `extensions/codex-bridge/lib/task-model.js`
- Create: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/package.json`

- [ ] **Step 1: Add a test script to `package.json`**

```json
{
  "scripts": {
    "test": "node --test extensions/codex-bridge/test/*.test.js",
    "check": "node --check extensions/codex-bridge/index.js"
  }
}
```

- [ ] **Step 2: Write the failing task-model test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_TASK_STATUSES,
  TERMINAL_TASK_STATUSES,
  canContinueTask,
  isActiveTaskStatus,
  isTerminalTaskStatus,
} from "../lib/task-model.js";

test("active and terminal task statuses match the approved protocol", () => {
  assert.deepEqual(ACTIVE_TASK_STATUSES, ["created", "running", "awaiting_approval"]);
  assert.deepEqual(TERMINAL_TASK_STATUSES, ["denied", "completed", "failed", "aborted"]);
  assert.equal(isActiveTaskStatus("awaiting_approval"), true);
  assert.equal(isTerminalTaskStatus("completed"), true);
  assert.equal(canContinueTask("completed"), false);
  assert.equal(canContinueTask("running"), true);
});
```

- [ ] **Step 3: Run the targeted test and confirm failure**

Run: `node --test extensions/codex-bridge/test/task-model.test.js`

Expected: FAIL with module-not-found or missing export errors.

- [ ] **Step 4: Implement the minimal task-model module**

```js
export const ACTIVE_TASK_STATUSES = ["created", "running", "awaiting_approval"];
export const TERMINAL_TASK_STATUSES = ["denied", "completed", "failed", "aborted"];

export function isActiveTaskStatus(status) {
  return ACTIVE_TASK_STATUSES.includes(status);
}

export function isTerminalTaskStatus(status) {
  return TERMINAL_TASK_STATUSES.includes(status);
}

export function canContinueTask(status) {
  return !isTerminalTaskStatus(status);
}
```

- [ ] **Step 5: Re-run the targeted test**

Run: `node --test extensions/codex-bridge/test/task-model.test.js`

Expected: PASS

- [ ] **Step 6: Run the package-level test command**

Run: `npm --prefix extensions/codex-bridge test`

Expected: PASS with one test file

- [ ] **Step 7: Commit the harness baseline**

```bash
git add extensions/codex-bridge/package.json \
        extensions/codex-bridge/lib/task-model.js \
        extensions/codex-bridge/test/task-model.test.js
git commit -m "test: add runner task-model harness"
```

### Task 2: Replace prompt-risk strings with stable policy decisions

**Files:**
- Create: `extensions/codex-bridge/lib/policy.js`
- Create: `extensions/codex-bridge/lib/fs-utils.js`
- Create: `extensions/codex-bridge/test/policy.test.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-model.js`

- [ ] **Step 1: Write the failing policy tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { assessPolicyDecision } from "../lib/policy.js";

test("protected runner state returns denied with a stable code", () => {
  const decision = assessPolicyDecision({
    prompt: "inspect logs",
    cwd: "/repo/.isolated/codex-feishu/state/codex-bridge",
    protectedRoots: ["/repo/.isolated/codex-feishu/state/codex-bridge"],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "denied");
  assert.deepEqual(decision.reasonCodes, ["isolation_boundary_denied"]);
});

test("service-control requests require approval", () => {
  const decision = assessPolicyDecision({
    prompt: "restart systemctl user service",
    cwd: "/home/neousys/project",
    protectedRoots: [],
    hostCodexRoot: "/home/neousys/.codex",
  });
  assert.equal(decision.kind, "approval_required");
  assert.deepEqual(decision.reasonCodes, ["service_control_requires_approval"]);
});
```

- [ ] **Step 2: Run the policy test and confirm failure**

Run: `node --test extensions/codex-bridge/test/policy.test.js`

Expected: FAIL because `policy.js` does not exist yet.

- [ ] **Step 3: Implement the minimal policy module with stable enums**

```js
export const POLICY_DECISIONS = {
  ALLOWED: "allowed",
  APPROVAL_REQUIRED: "approval_required",
  DENIED: "denied",
};

export function assessPolicyDecision(input) {
  if (isProtectedRunnerPath(input.cwd, input.protectedRoots)) {
    return deny("isolation_boundary_denied");
  }
  if (/\b(systemctl|systemd)\b/i.test(input.prompt)) {
    return approve("service_control_requires_approval");
  }
  return allow();
}
```

- [ ] **Step 4: Replace `assessRisk()` call sites with `assessPolicyDecision()`**

```js
const decision = assessPolicyDecision({
  prompt: params.prompt,
  cwd,
  settings: this.settings,
});

if (decision.kind === "denied") { ... }
if (decision.kind === "approval_required") { ... }
```

- [ ] **Step 5: Persist reason codes on approvals and denied tasks**

```js
const approval = {
  ...,
  policyDecision: decision.kind,
  reasonCodes: decision.reasonCodes,
};
```

- [ ] **Step 6: Re-run the targeted policy tests**

Run: `node --test extensions/codex-bridge/test/policy.test.js`

Expected: PASS

- [ ] **Step 7: Run the full local suite**

Run: `npm --prefix extensions/codex-bridge test`

Expected: PASS with task-model and policy tests

- [ ] **Step 8: Commit the policy layer**

```bash
git add extensions/codex-bridge/index.js \
        extensions/codex-bridge/lib/policy.js \
        extensions/codex-bridge/lib/fs-utils.js \
        extensions/codex-bridge/test/policy.test.js
git commit -m "feat: add stable runner policy decisions"
```

### Task 3: Fix `codex exec` environment leakage and resume cwd semantics

**Files:**
- Create: `extensions/codex-bridge/lib/settings.js`
- Create: `extensions/codex-bridge/lib/codex-exec.js`
- Create: `extensions/codex-bridge/test/codex-exec.test.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `config/openclaw.codex-feishu.json5`

- [ ] **Step 1: Write the failing exec-environment test**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { buildCodexEnv, buildCodexArgs } from "../lib/codex-exec.js";

test("buildCodexEnv only forwards allowlisted variables", () => {
  const env = buildCodexEnv({
    codexHome: "/tmp/codex-home",
    inheritedEnv: {
      PATH: "/usr/bin",
      HOME: "/home/neousys",
      CODEX_FEISHU_APP_SECRET: "secret",
      OPENAI_API_KEY: "secret",
    },
  });

  assert.equal(env.CODEX_HOME, "/tmp/codex-home");
  assert.equal(env.PATH, "/usr/bin");
  assert.equal("CODEX_FEISHU_APP_SECRET" in env, false);
  assert.equal("OPENAI_API_KEY" in env, false);
});

test("resume mode still carries explicit cwd semantics in prompt metadata", () => {
  const args = buildCodexArgs({
    task: { mode: "resume", cwd: "/repo/worktree", prompt: "continue", sessionId: "1234" },
    settings: { locale: "en-US" },
  });
  assert.equal(args.includes("-C"), false);
  assert.equal(args.at(-1).includes("Working directory: /repo/worktree"), true);
});
```

- [ ] **Step 2: Run the exec test and confirm failure**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js`

Expected: FAIL because `codex-exec.js` is not implemented yet.

- [ ] **Step 3: Implement `buildCodexEnv()` with an explicit allowlist**

```js
const DEFAULT_ENV_ALLOWLIST = ["HOME", "PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME"];

export function buildCodexEnv({ codexHome, inheritedEnv, envAllowlist = DEFAULT_ENV_ALLOWLIST }) {
  const env = Object.fromEntries(
    envAllowlist
      .filter((key) => inheritedEnv[key] !== undefined)
      .map((key) => [key, inheritedEnv[key]]),
  );
  env.CODEX_HOME = codexHome;
  return env;
}
```

- [ ] **Step 4: Move argument building into `codex-exec.js` and keep resume cwd explicit**

```js
export function buildCodexArgs({ task, settings }) {
  if (task.mode === "resume") {
    return ["exec", "resume", ...sharedArgs(task), task.sessionId, buildRunnerPrompt({ task, settings })];
  }
  return ["exec", ...sharedArgs(task), "-C", task.cwd, buildRunnerPrompt({ task, settings })];
}
```

- [ ] **Step 5: Add config support for env allowlist**

```json5
"codex-bridge": {
  enabled: true,
  config: {
    envAllowlist: ["HOME", "PATH", "LANG", "LC_ALL", "TERM", "USER", "LOGNAME"]
  }
}
```

- [ ] **Step 6: Wire the new helpers into `index.js`**

```js
const args = buildCodexArgs({ task, settings: this.settings });
const env = buildCodexEnv({
  codexHome: this.settings.codexHome,
  inheritedEnv: process.env,
  envAllowlist: this.settings.envAllowlist,
});
```

- [ ] **Step 7: Re-run targeted tests**

Run: `node --test extensions/codex-bridge/test/codex-exec.test.js`

Expected: PASS

- [ ] **Step 8: Run syntax and config validation**

Run: `node --check extensions/codex-bridge/index.js`

Expected: exits 0

Run: `bash scripts/bootstrap-codex-feishu.sh render-config`

Expected: exits 0 and renders isolated config successfully

- [ ] **Step 9: Commit the boundary fix**

```bash
git add extensions/codex-bridge/index.js \
        extensions/codex-bridge/lib/settings.js \
        extensions/codex-bridge/lib/codex-exec.js \
        extensions/codex-bridge/test/codex-exec.test.js \
        config/openclaw.codex-feishu.json5
git commit -m "fix: isolate codex execution environment"
```

### Task 4: Introduce the task/run split model and persistence

**Files:**
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/index.js`

- [ ] **Step 1: Write the failing task/run-model tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_TASK_STATUSES,
  RUN_STATUSES,
  finishRunWithApprovalRequired,
  finishRunWithDeniedAction,
  finishRunWithResult,
} from "../lib/task-model.js";

test("task statuses and run statuses match the revised protocol", () => {
  assert.deepEqual(ACTIVE_TASK_STATUSES, ["created", "running", "awaiting_input", "awaiting_approval"]);
  assert.deepEqual(RUN_STATUSES, ["running", "completed", "failed", "aborted", "blocked"]);
});

test("approval-required transition blocks the run and moves the task to awaiting_approval", () => {
  const next = finishRunWithApprovalRequired();
  assert.deepEqual(next, {
    taskStatus: "awaiting_approval",
    runStatus: "blocked",
  });
});

test("denied actions block the run and return the task to awaiting_input", () => {
  const next = finishRunWithDeniedAction();
  assert.deepEqual(next, {
    taskStatus: "awaiting_input",
    runStatus: "blocked",
  });
});

test("completed and failed runs default the task back to awaiting_input", () => {
  assert.deepEqual(finishRunWithResult("completed"), {
    taskStatus: "awaiting_input",
    runStatus: "completed",
  });
  assert.deepEqual(finishRunWithResult("failed"), {
    taskStatus: "awaiting_input",
    runStatus: "failed",
  });
});
```

- [ ] **Step 2: Run the targeted task-model tests and confirm failure**

Run: `node --test extensions/codex-bridge/test/task-model.test.js`

Expected: FAIL because the new statuses/transitions are not implemented yet.

- [ ] **Step 3: Implement the minimal task/run split helpers**

```js
export const ACTIVE_TASK_STATUSES = ["created", "running", "awaiting_input", "awaiting_approval"];
export const RUN_STATUSES = ["running", "completed", "failed", "aborted", "blocked"];

export function finishRunWithApprovalRequired() {
  return { taskStatus: "awaiting_approval", runStatus: "blocked" };
}

export function finishRunWithDeniedAction() {
  return { taskStatus: "awaiting_input", runStatus: "blocked" };
}

export function finishRunWithResult(runStatus) {
  return { taskStatus: "awaiting_input", runStatus };
}
```

- [ ] **Step 4: Extend the task store to persist runs separately from tasks**

```js
const task = {
  ...,
  status: "awaiting_input",
  currentRunId: null,
};

const run = {
  runId,
  taskId,
  status: "running",
  inputText,
};
```

- [ ] **Step 5: Update `index.js` to persist both task and run objects**

```js
const task = await taskStore.createTask(...);
const run = await taskStore.createRun(...);
task.currentRunId = run.runId;
```

- [ ] **Step 6: Re-run the targeted task-model tests**

Run: `node --test extensions/codex-bridge/test/task-model.test.js`

Expected: PASS

- [ ] **Step 7: Run full package tests**

Run: `npm --prefix extensions/codex-bridge test`

Expected: PASS with updated task-model coverage

- [ ] **Step 8: Commit the task/run foundation**

```bash
git add extensions/codex-bridge/index.js \
        extensions/codex-bridge/lib/task-model.js \
        extensions/codex-bridge/lib/task-store.js \
        extensions/codex-bridge/test/task-model.test.js \
        extensions/codex-bridge/test/routing.test.js
git commit -m "feat: split runner tasks from runs"
```

### Task 5: Rebuild routing, continue, and approval flow on top of task/run

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Write the failing routing tests for task/run semantics**

```js
import test from "node:test";
import assert from "node:assert/strict";
import {
  routeIncomingPlainText,
  routeContinueCommand,
  startNextRunFromApproval,
} from "../lib/task-model.js";

test("plain text starts a new task when there is no active task", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: null }), {
    action: "create_task",
  });
});

test("plain text auto-continues only when task is awaiting_input", () => {
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "awaiting_input" }), {
    action: "continue_task",
  });
  assert.deepEqual(routeIncomingPlainText({ activeTaskStatus: "running" }), {
    action: "reject",
    code: "active_task_exists",
  });
});

test("continue command requires an active task and creates a next run", () => {
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: null }), {
    accepted: false,
    code: "no_active_task",
  });
  assert.deepEqual(routeContinueCommand({ activeTaskStatus: "awaiting_input" }), {
    accepted: true,
    action: "create_next_run",
  });
});

test("approval creates a new run instead of resuming the old run", () => {
  assert.deepEqual(startNextRunFromApproval(), {
    taskStatus: "running",
    action: "create_next_run",
  });
});
```

- [ ] **Step 2: Run the targeted routing test and confirm failure**

Run: `node --test extensions/codex-bridge/test/routing.test.js`

Expected: FAIL because the current routing helpers still reflect the older one-task/one-run model.

- [ ] **Step 3: Implement the minimal routing helpers**

```js
export function routeIncomingPlainText({ activeTaskStatus }) {
  if (!activeTaskStatus) return { action: "create_task" };
  if (activeTaskStatus === "awaiting_input") return { action: "continue_task" };
  return { action: "reject", code: "active_task_exists" };
}

export function routeContinueCommand({ activeTaskStatus }) {
  if (!activeTaskStatus) return { accepted: false, code: "no_active_task" };
  return { accepted: true, action: "create_next_run" };
}
```

- [ ] **Step 4: Update `index.js` to create new runs instead of pretending to resume the same run**

```js
if (route.action === "continue_task") {
  const run = await taskStore.createRun({ taskId: activeTask.taskId, ... });
  await taskStore.updateTask(activeTask.taskId, { status: "running", currentRunId: run.runId });
}
```

- [ ] **Step 5: Update locale text to reflect the new semantics**

```js
help: () => [
  "`/codex continue <prompt>` add explicit input to the current active task",
].join("\\n")
```

- [ ] **Step 6: Re-run routing tests**

Run: `node --test extensions/codex-bridge/test/routing.test.js`

Expected: PASS

- [ ] **Step 7: Run full package checks**

Run: `npm --prefix extensions/codex-bridge test`

Expected: PASS

Run: `npm --prefix extensions/codex-bridge run check`

Expected: PASS

- [ ] **Step 8: Commit the routing rewrite**

```bash
git add extensions/codex-bridge/index.js \
        extensions/codex-bridge/lib/locale.js \
        extensions/codex-bridge/lib/task-store.js \
        extensions/codex-bridge/lib/task-model.js \
        extensions/codex-bridge/test/routing.test.js
git commit -m "feat: route tasks through serial runs"
```

### Task 6: Update operator docs and verify the new contract

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-03-24-safe-runner-core-design.md`

- [ ] **Step 1: Update the protocol documentation**

Document these items explicitly:

- stable task statuses and run statuses
- task/run split
- single active task rule
- explicit `/codex continue` and `awaiting_input` semantics
- stable policy decision categories
- initial stable reason codes

- [ ] **Step 2: Update the repository README positioning**

Add a concise operator-facing summary such as:

```md
- Core product: safe execution core
- Current Feishu integration: OpenClaw transport shell
- Minimal stable outputs: text, status, approval
- One task may span multiple serial runs
```

- [ ] **Step 3: Add a short “implementation status” note to the spec**

```md
## Implementation Status

- Planned extraction modules: settings, policy, task-model, task-store, codex-exec, locale
- First implementation priority complete: env allowlist, resume cwd, policy decision core
- Current protocol shift: task/run split with `awaiting_input` and serial runs
```

- [ ] **Step 4: Run the full verification set**

Run: `npm --prefix extensions/codex-bridge test`

Expected: PASS

Run: `node --check extensions/codex-bridge/index.js`

Expected: exits 0

Run: `bash scripts/bootstrap-codex-feishu.sh render-config`

Expected: exits 0

- [ ] **Step 5: Commit docs and verification updates**

```bash
git add README.md \
        docs/feishu-codex-runner-v1.md \
        docs/superpowers/specs/2026-03-24-safe-runner-core-design.md
git commit -m "docs: document safe runner core contract"
```

## Suggested Execution Order

1. Task 1 — build the harness and status vocabulary
2. Task 2 — introduce stable policy decisions and reason codes
3. Task 3 — fix env leakage and explicit resume semantics
4. Task 4 — introduce the task/run split foundation
5. Task 5 — rewrite routing and approval around serial runs
6. Task 6 — update docs and rerun verification

## Validation Checklist

- `npm --prefix extensions/codex-bridge test`
- `node --check extensions/codex-bridge/index.js`
- `bash scripts/bootstrap-codex-feishu.sh render-config`

Expected final state:

- no inherited secret env vars forwarded into `codex exec`
- approval and denial both carry stable reason codes
- task and run are persisted separately
- `awaiting_input` and `awaiting_approval` are first-class task statuses
- `blocked` is a first-class run outcome
- plain text auto-continues only when task status is `awaiting_input`
- `/codex continue` creates the next run within the current task
- docs reflect the safe-runner-core contract

## Risks To Watch During Execution

- Avoid refactoring `index.js` into too many modules at once; keep extractions narrowly tied to the approved protocol.
- Keep `OpenClaw` integration points stable; do not accidentally rewrite the Feishu transport path.
- Ensure localized strings remain derived from stable status values and reason codes rather than becoming the protocol source.
- Preserve backwards readability of existing task JSON where reasonable, but prefer protocol correctness over legacy wording.
- Do not accidentally reintroduce one-task/one-run assumptions while wiring approval or continue flows.
