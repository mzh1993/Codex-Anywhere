# Bridge Action Runtime Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a bridge-owned control-plane execution lane so repository-owned host actions are handled directly by the bridge without polluting normal Codex task continuity.

**Architecture:** Keep the existing `codex task` lane intact for normal work, but introduce a separate `bridge action` lane with its own persistence, status model, approval flow, and direct execution path. Routing should stay natural-language-first: ordinary work continues to Codex, repository-owned control-plane actions are claimed by bridge only when bridge clearly owns the semantics, and both lanes can share one DM without sharing continuity state.

**Tech Stack:** Node.js ESM, `extensions/codex-bridge`, `node:test`, existing locale/policy/task-store helpers, repository-local bridge runtime.

---

## Scope

- In scope:
  - add `bridge action` runtime model and persistence
  - route repository-owned control-plane requests into bridge-owned execution
  - keep current `codex task` approval behavior intact
  - ensure `bridge action` does not overwrite Codex task summary, cwd, next steps, or session continuity
  - add automated tests and V1 protocol doc updates
- Out of scope:
  - generic host operations console
  - broad policy redesign beyond owned-control-plane detection
  - non-Feishu channel integration
  - rich card UI or image output

## Preconditions

- Product rules live in `docs/product-decision-baseline.md`
- Runtime boundary design lives in `docs/superpowers/specs/2026-03-25-bridge-owned-control-plane-design.md`
- Gray acceptance gate lives in `docs/superpowers/specs/2026-03-25-bridge-action-gray-acceptance-matrix.md`
- Do not start implementation until these three documents agree

## File Map

- Create: `extensions/codex-bridge/lib/bridge-action-model.js`
  - Define bridge-action statuses, narrow action kinds, routing helpers, and execution-result transitions.
- Create: `extensions/codex-bridge/lib/bridge-action-store.js`
  - Define bridge-action record creation, serialization, persistence helpers, and recovery-safe transitions.
- Create: `extensions/codex-bridge/test/bridge-action-model.test.js`
  - Lock status schema, ownership rules, and transition behavior.
- Create: `extensions/codex-bridge/test/bridge-action-store.test.js`
  - Lock persistence shape and continuity-separation guarantees.
- Create: `extensions/codex-bridge/test/runtime-control-plane.test.js`
  - Cover end-to-end routing, approval, execution, denial, and return-to-task behavior.
- Modify: `extensions/codex-bridge/index.js`
  - Integrate bridge-action routing, approval ownership, direct execution, and response shaping.
- Modify: `extensions/codex-bridge/lib/policy.js`
  - Distinguish repository-owned control-plane requests from generic risky host operations.
- Modify: `extensions/codex-bridge/lib/task-model.js`
  - Remove assumptions that all bridge-owned input must map back into task approval.
- Modify: `extensions/codex-bridge/lib/task-store.js`
  - Keep task persistence task-only; avoid leaking bridge-action fields into task records.
- Modify: `extensions/codex-bridge/lib/settings.js`
  - Add a dedicated bridge-action persistence root derived from the isolated state root.
- Modify: `extensions/codex-bridge/lib/locale.js`
  - Add minimal bridge-action approval / result copy without increasing user reading burden.
- Modify: `docs/feishu-codex-runner-v1.md`
  - Reflect the implemented runtime once tests pass.

## Task 1: Introduce a separate bridge-action model

**Files:**
- Create: `extensions/codex-bridge/lib/bridge-action-model.js`
- Create: `extensions/codex-bridge/test/bridge-action-model.test.js`
- Modify: `extensions/codex-bridge/lib/task-model.js`

- [ ] **Step 1: Write failing schema tests for bridge-action statuses and kinds**

Add tests for:

```js
assert.deepEqual(BRIDGE_ACTION_STATUSES, ["created", "awaiting_approval", "running", "finished"]);
assert.deepEqual(BRIDGE_ACTION_KINDS, ["service_control", "gateway_health", "install_lifecycle", "diagnostic"]);
```

- [ ] **Step 2: Run the new test file and verify it fails**

Run: `node --test extensions/codex-bridge/test/bridge-action-model.test.js`
Expected: FAIL because bridge-action exports do not exist yet.

- [ ] **Step 3: Implement the minimal bridge-action model**

Add:

- status constants
- narrow action-kind constants
- transition helpers for approval, denial, execution success/failure
- ownership helpers that keep `bridge action` out of `codex task` continuity

- [ ] **Step 4: Update `task-model.js` to keep task owner logic task-only**

Expected changes:

- `TASK_OWNERS` no longer acts as a dumping ground for future bridge concepts
- task routing remains about `codex` and `bridge_approval`
- bridge-action routing stays in the new model, not hidden inside task helpers

- [ ] **Step 5: Re-run the model tests**

Run: `node --test extensions/codex-bridge/test/bridge-action-model.test.js extensions/codex-bridge/test/task-model.test.js`
Expected: PASS

## Task 2: Add bridge-action persistence without polluting task records

**Files:**
- Create: `extensions/codex-bridge/lib/bridge-action-store.js`
- Create: `extensions/codex-bridge/test/bridge-action-store.test.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/lib/settings.js`

- [ ] **Step 1: Write failing persistence tests for bridge-action records**

Cover:

- record shape does not include task summary / next steps / changed files
- action result does not overwrite task session or cwd continuity
- bridge-action approval state is persisted independently from task approval state

- [ ] **Step 2: Run the persistence tests and verify they fail**

Run: `node --test extensions/codex-bridge/test/bridge-action-store.test.js`
Expected: FAIL because store helpers do not exist yet.

- [ ] **Step 3: Implement bridge-action record factory and storage helpers**

Store under a dedicated subtree such as:

- `bridge-actions/<action>.json`
- optional lightweight execution logs under `bridge-actions/<action>/`
- expose the root via `settings.js`, not by hardcoding ad hoc paths in `index.js`

- [ ] **Step 4: Keep `task-store.js` task-only**

Explicitly avoid:

- adding bridge-action fields to task records
- reusing task summary fields for bridge-action completion
- encoding bridge-action execution in `currentRunId` / `lastRunId`

- [ ] **Step 5: Re-run persistence tests**

Run: `node --test extensions/codex-bridge/test/bridge-action-store.test.js extensions/codex-bridge/test/task-store.test.js`
Expected: PASS

## Task 3: Teach policy and routing to recognize owned control-plane requests

**Files:**
- Modify: `extensions/codex-bridge/lib/policy.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Write failing routing tests for owned vs non-owned control-plane inputs**

Must cover:

- `请重启 openclaw-codex-feishu.service` → bridge action
- `请帮我检查 gateway 健康状态` → bridge action
- `请重启 nginx` → not bridge-owned
- `请 docker restart xxx` → not bridge-owned

- [ ] **Step 2: Run the routing tests and verify they fail**

Run: `node --test extensions/codex-bridge/test/routing.test.js`
Expected: FAIL because bridge-action routing does not exist yet.

- [ ] **Step 3: Add a narrow owned-control-plane classifier**

Rules:

- whitelist repository-owned unit names and lifecycle actions
- allow read-only bridge diagnostics owned by this repository
- refuse to widen into arbitrary host operations
- if ownership is unclear, fall back to normal Codex routing

- [ ] **Step 4: Integrate routing order in `index.js`**

Apply the order from the design:

1. approval reply already owned by bridge
2. new repository-owned bridge action
3. otherwise Codex task path

- [ ] **Step 5: Re-run the routing tests**

Run: `node --test extensions/codex-bridge/test/routing.test.js`
Expected: PASS

## Task 4: Implement bridge-action approval and direct execution

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Create: `extensions/codex-bridge/test/runtime-control-plane.test.js`

- [ ] **Step 1: Write failing runtime tests for bridge-action approval flow**

Cover:

- create action from natural-language control-plane request
- `为什么要审批？` keeps gate open
- `同意` executes directly in bridge
- `同意，并……` is rejected or clarified unless V1 explicitly supports tail for bridge action
- `不要执行` closes safely without touching Codex task continuity

- [ ] **Step 2: Run the runtime tests and verify they fail**

Run: `node --test extensions/codex-bridge/test/runtime-control-plane.test.js`
Expected: FAIL because direct bridge-action execution does not exist yet.

- [ ] **Step 3: Add bridge-action execution handlers in `index.js`**

Expected structure:

- minimal executor for repository-owned service control
- minimal executor for gateway health / install lifecycle / diagnostics
- isolated result object with short user-facing completion summary

- [ ] **Step 4: Add locale copy that stays shorter than task completion copy**

Required qualities:

- no task summary sections
- no changed-files block
- no noisy internal progress
- no ids unless user explicitly uses fallback/debug path

- [ ] **Step 5: Re-run the runtime control-plane tests**

Run: `node --test extensions/codex-bridge/test/runtime-control-plane.test.js`
Expected: PASS

## Task 5: Protect Codex task continuity while bridge actions run alongside it

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/runtime-contract.test.js`

- [ ] **Step 1: Write failing continuity tests**

Cover:

- an existing `awaiting_input` Codex task survives a bridge action unchanged
- bridge action completion does not rewrite task summary / next steps / cwd
- after bridge action completes, the next normal text still continues the original Codex task
- bridge action denial does not abort the active Codex task

- [ ] **Step 2: Run the continuity tests and verify they fail**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js`
Expected: FAIL on new continuity assertions.

- [ ] **Step 3: Implement continuity separation in `index.js`**

Rules:

- no `profile.activeTaskId` mutation just because a bridge action exists
- no task-run summary updates from bridge action results
- shared DM, separate continuity objects

- [ ] **Step 4: Re-run the continuity tests**

Run: `node --test extensions/codex-bridge/test/runtime-compatibility.test.js extensions/codex-bridge/test/runtime-contract.test.js`
Expected: PASS

## Task 6: Align protocol docs only after runtime behavior is proven

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Update the V1 protocol doc to describe the implemented bridge-action lane**

Add only what is now true in code:

- bridge-action scope
- bridge-action approval semantics
- continuity separation from `codex task`
- fallback-command behavior if any remains necessary

- [ ] **Step 2: Review wording against the decision baseline and acceptance matrix**

Check against:

- `docs/product-decision-baseline.md`
- `docs/superpowers/specs/2026-03-25-bridge-action-gray-acceptance-matrix.md`

## Task 7: Final verification gate

**Files:**
- Review: `extensions/codex-bridge/index.js`
- Review: `extensions/codex-bridge/lib/bridge-action-model.js`
- Review: `extensions/codex-bridge/lib/bridge-action-store.js`
- Review: `extensions/codex-bridge/lib/policy.js`
- Review: `extensions/codex-bridge/lib/task-model.js`
- Review: `extensions/codex-bridge/lib/task-store.js`
- Review: `extensions/codex-bridge/lib/settings.js`
- Review: `extensions/codex-bridge/lib/locale.js`
- Review: `extensions/codex-bridge/test/bridge-action-model.test.js`
- Review: `extensions/codex-bridge/test/bridge-action-store.test.js`
- Review: `extensions/codex-bridge/test/runtime-control-plane.test.js`
- Review: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Review: `extensions/codex-bridge/test/runtime-contract.test.js`
- Review: `docs/feishu-codex-runner-v1.md`

- [ ] **Step 1: Run focused bridge tests**

Run:

```bash
node --test \
  extensions/codex-bridge/test/bridge-action-model.test.js \
  extensions/codex-bridge/test/bridge-action-store.test.js \
  extensions/codex-bridge/test/routing.test.js \
  extensions/codex-bridge/test/runtime-control-plane.test.js \
  extensions/codex-bridge/test/runtime-compatibility.test.js \
  extensions/codex-bridge/test/runtime-contract.test.js \
  extensions/codex-bridge/test/task-model.test.js \
  extensions/codex-bridge/test/task-store.test.js
```

Expected: PASS

- [ ] **Step 2: Run syntax verification**

Run: `node --check extensions/codex-bridge/index.js`
Expected: PASS

- [ ] **Step 3: Validate against the gray acceptance matrix**

Check every `P0` / `P1` scenario in:

- `docs/superpowers/specs/2026-03-25-bridge-action-gray-acceptance-matrix.md`

- [ ] **Step 4: Prepare rollout handoff**

Include:

- what changed in routing
- what control-plane scope V1 owns
- which scenarios remain intentionally unsupported
- which fallback commands still exist and why
