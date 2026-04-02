# Revive Task Lane Tool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repo-local operations tool that safely revives an interrupted bridge task lane and updates `AGENTS.md` so repo-scoped agents prefer the tool over manual state edits.

**Architecture:** Split the work into a pure core module for validation and state transformation, a thin CLI wrapper in `tools/`, and a focused `node:test` suite that exercises dry-run, live-run, and fail-closed behavior. Keep the tool outside the bridge runtime boundary.

**Tech Stack:** Node.js ESM, `node:test`, `fs/promises`, JSON persistence

---

### Task 1: Lock The Revival Contract In Tests

**Files:**
- Create: `tools/test/revive-task-lane.test.mjs`

- [ ] **Step 1: Write a failing dry-run test**

Assert the tool reports intended changes but leaves profile/task files untouched.

- [ ] **Step 2: Write a failing live revive test**

Assert the tool:
- creates backups
- changes `task.status` to `awaiting_input`
- sets `requiresExplicitContinue`
- repoints `profile.activeTaskId`

- [ ] **Step 3: Write a failing fail-closed test**

Assert mismatched sender/task identity throws and does not mutate files.

- [ ] **Step 4: Run the targeted test file and confirm failure**

Run:

```bash
node --test tools/test/revive-task-lane.test.mjs
```

Expected: FAIL because the tool does not exist yet.

### Task 2: Implement The Core Revival Logic

**Files:**
- Create: `tools/lib/revive-task-lane-core.mjs`

- [ ] **Step 1: Add JSON read/write helpers and backup naming**

Keep helpers local to the tool module and avoid coupling to bridge runtime internals.

- [ ] **Step 2: Implement validation**

Fail closed for missing files, sender mismatches, conversation mismatches, and non-revivable task states.

- [ ] **Step 3: Implement dry-run planning**

Return a summary object describing the proposed repair without writing files.

- [ ] **Step 4: Implement live repair**

Create backups, rewrite task/profile, and return a concise summary payload.

### Task 3: Add The CLI Wrapper

**Files:**
- Create: `tools/revive-task-lane.mjs`

- [ ] **Step 1: Parse minimal flags**

Support only:
- `--sender-id`
- `--task-id`
- `--dry-run`

- [ ] **Step 2: Resolve the default bridge state root from repo layout**

Default to:

```text
$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge
```

- [ ] **Step 3: Print a clear operator summary**

Show:
- selected sender
- selected task
- whether it was dry-run or applied
- active lane fields after repair

### Task 4: Add The Repo-Local Agent Hook

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Add a repo-local operations note**

State that continuity-state recovery should prefer:

```bash
node tools/revive-task-lane.mjs --sender-id <sender> --task-id <task>
```

instead of hand-editing persisted bridge state JSON.

- [ ] **Step 2: Keep the note explicitly repo-local**

Do not frame it as a bridge feature or a global superpowers capability.

### Task 5: Verify And Close

**Files:**
- Modify: working tree only

- [ ] **Step 1: Run the targeted tool tests**

Run:

```bash
node --test tools/test/revive-task-lane.test.mjs
```

Expected: PASS.

- [ ] **Step 2: Re-run the bridge regression suite**

Run:

```bash
node --test extensions/codex-bridge/test/*.test.js
```

Expected: PASS with no bridge regressions.

- [ ] **Step 3: Verify worktree scope**

Run:

```bash
git status --short
```

Expected: only the revive tool, tests, docs, and `AGENTS.md` changes are present.
