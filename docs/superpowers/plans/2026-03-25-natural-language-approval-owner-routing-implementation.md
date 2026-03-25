# Natural-Language Approval Owner Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make approval feel like native Codex conversation while keeping authorization as a bridge-owned safety boundary.

**Architecture:** Keep the current task / run / approval persistence model, but add one internal routing layer: `owner`. Normal conversation stays `owner=codex`; pending approvals switch to `owner=bridge_approval`; only bridge code may move between them. Approval interpretation stays narrow and contract-based: the bridge matches replies only against a frozen `replyContract` and `onDeny`, never against a broad free-form keyword guesser.

**Tech Stack:** Node.js ESM, existing `codex-bridge` modules, built-in `node:test`.

---

## Scope

- In scope:
  - persist internal `owner` on tasks
  - persist approval `replyContract` and `onDeny`
  - route incoming plain text by owner first
  - support `approve`, `deny`, `approve_with_tail`, and `keep_gate_open`
  - keep fallback `/codex ...` commands owner-neutral in normal `owner=codex` flow
  - update bridge wording so approval feels natural-language-first
- Out of scope:
  - card approval UI
  - multiple simultaneous approval points per sender
  - paused-state taxonomy beyond existing statuses
  - model-driven approval interpretation
  - unrelated runtime hardening or OpenClaw bootstrap changes

## File Map

- Modify: `extensions/codex-bridge/lib/task-model.js`
  - Add owner enums / helpers, approval reply classification, and deny transition helpers.
- Modify: `extensions/codex-bridge/lib/task-store.js`
  - Persist `owner` on task records and keep backward compatibility for older stored tasks.
- Modify: `extensions/codex-bridge/lib/locale.js`
  - Add concise approval prompts, keep-gate-open explanation text, and deny/replan wording.
- Modify: `extensions/codex-bridge/index.js`
  - Route plain text by owner, persist approval `replyContract` / `onDeny`, consume natural-language approval replies, and keep fallback commands owner-neutral.
- Modify: `extensions/codex-bridge/test/task-model.test.js`
  - Lock owner schema, approval classification, and deny transitions.
- Modify: `extensions/codex-bridge/test/task-store.test.js`
  - Lock persistence defaults, approval record shape, and backward-compat recovery of tasks without `owner`.
- Modify: `extensions/codex-bridge/test/routing.test.js`
  - Lock owner-first routing, command neutrality, natural-language approval, and tail-forwarding.
- Optional modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
  - Only if needed to prove resumed runs and approval resumes preserve session / cwd semantics.
- Modify after code passes: `docs/feishu-codex-runner-v1.md`
  - Sync protocol docs to the new owner-first approval behavior.
- Modify after code passes: `README.md`
  - Sync the user-facing interaction notes so bridge commands stay explicitly fallback-only.

## Product Rules To Preserve

- `渠道不决定执行语义` remains the top rule.
- Ordinary user text belongs to Codex unless bridge is currently guarding a boundary.
- Approval is a bridge-owned boundary; approval replies are never forwarded to Codex first.
- `/codex ...` commands are fallback controls, not the primary interaction model.
- Fallback commands in `owner=codex` must not mutate owner unless bridge itself creates a new pending point.
- `keep_gate_open` must explain or clarify without authorizing.

## Data Contract Decisions For MVP

- Task `owner` values:
  - `codex` for normal steady state and `awaiting_input`
  - `bridge_approval` for `awaiting_approval`
  - `null` only for terminalized tasks if needed by existing abort flow
- Approval `replyContract`:
  - Start with one narrow contract family for natural-language yes / no approval
  - Support optional tail text after approval
  - Do not accept numeric shortcuts unless the prompt explicitly offered them
- Approval `onDeny`:
  - Support `await_user_replan`
  - Support `abort_task`
  - Current policy-driven approval call sites should default to `await_user_replan` unless a concrete bridge-owned flow truly requires hard abort

### Task 1: Lock owner-first behavior with failing tests

**Files:**
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/test/task-store.test.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/task-model.test.js`
- Test: `extensions/codex-bridge/test/task-store.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Add task-model tests for owner defaults**
  - Expect new steady-state tasks to behave as `owner=codex`.
  - Expect approval-blocked tasks to behave as `owner=bridge_approval`.
- [ ] **Step 2: Add approval-classification tests**
  - Cover `approve`, `deny`, `approve_with_tail`, and `keep_gate_open`.
  - Cover “`1` without numbered options” staying non-authorizing.
- [ ] **Step 3: Add routing tests for owner-first plain-text handling**
  - `owner=codex` plain text continues or creates work.
  - `owner=bridge_approval` plain text stays inside bridge approval handling first.
- [ ] **Step 4: Add routing tests for fallback command neutrality**
  - `/codex status` in `owner=codex` must not switch owner.
  - `/codex status` in `owner=bridge_approval` must not accidentally approve or deny.
- [ ] **Step 5: Add persistence tests for new schema fields**
  - New tasks serialize `owner`.
  - Approval queue / read paths preserve `replyContract` and `onDeny`.
  - Older stored tasks without these fields are normalized safely on read / update paths.
- [ ] **Step 6: Run targeted tests and confirm failure**
  - Run: `cd extensions/codex-bridge && node --test test/task-model.test.js test/task-store.test.js test/routing.test.js`

### Task 2: Add owner and approval schema support without breaking stored data

**Files:**
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/task-store.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Add `owner` defaults in task creation helpers**
  - `createTaskRecord()` should default to `codex`.
  - `createAwaitingApprovalTaskRecord()` should force `bridge_approval`.
- [ ] **Step 2: Add approval record fields**
  - Persist `replyContract` and `onDeny` on queued approvals in bridge-owned approval write paths.
- [ ] **Step 3: Add deny transition helpers**
  - `await_user_replan` returns the task to `awaiting_input` with `owner=codex`.
  - `abort_task` terminates the task without a continuation owner.
- [ ] **Step 4: Add backward-compatible normalization**
  - Older tasks without `owner` should behave as `codex` unless they are clearly `awaiting_approval`.
  - Older approvals without `replyContract` should upgrade to the default contract on bridge read paths.
- [ ] **Step 5: Re-run targeted schema tests**
  - Run: `cd extensions/codex-bridge && node --test test/task-model.test.js test/task-store.test.js`

### Task 3: Route inbound text by owner before text intent

**Files:**
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`

- [ ] **Step 1: Replace status-only plain-text routing with owner-first routing**
  - `owner=codex` keeps the Phase 1 natural-language flow.
  - `owner=bridge_approval` diverts plain text into bridge approval evaluation.
- [ ] **Step 2: Keep fallback slash commands as control-plane escapes**
  - `status`, `pwd`, `cwd`, and `abort` remain bridge-owned commands.
  - In `owner=codex`, these commands do not mutate owner unless they create a new pending point.
- [ ] **Step 3: Keep approval state command-safe**
  - `status` during approval reports state without consuming approval.
  - `abort` during approval can still terminate the task explicitly.
- [ ] **Step 4: Preserve existing running-task protection**
  - Plain text must still not queue-jump while a run is actively `running`.
- [ ] **Step 5: Re-run routing tests**
  - Run: `cd extensions/codex-bridge && node --test test/routing.test.js`

### Task 4: Implement natural-language approval handling in the bridge

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`

- [ ] **Step 1: Freeze approval contracts when bridge queues approval**
  - Both new-task and existing-task approval paths must write the same explicit contract metadata.
- [ ] **Step 2: Match plain-text approval replies only against that contract**
  - `approve` grants approval and restores `owner=codex`.
  - `deny` follows the frozen `onDeny`.
  - `approve_with_tail` resumes work with only the post-approval tail forwarded to Codex.
- [ ] **Step 3: Add keep-gate-open behavior**
  - Non-authorizing replies such as “为什么要审批？” or “你看着办” stay inside approval mode.
  - Bridge responds briefly and keeps `owner=bridge_approval`.
- [ ] **Step 4: Make approval prompts concise**
  - Say what is blocked, why it needs approval, and what natural-language replies are accepted.
  - Keep `/codex approve <token>` as explicit fallback only.
- [ ] **Step 5: Re-run targeted approval tests**
  - Run: `cd extensions/codex-bridge && node --test test/task-model.test.js test/routing.test.js`

### Task 5: Verify end-to-end behavior and sync docs

**Files:**
- Test: `extensions/codex-bridge/test/task-model.test.js`
- Test: `extensions/codex-bridge/test/task-store.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Test: `extensions/codex-bridge/test/persistence-reliability.test.js`
- Modify after passing code tests: `docs/feishu-codex-runner-v1.md`
- Modify after passing code tests: `README.md`

- [ ] **Step 1: Run the focused protocol suite**
  - Run: `cd extensions/codex-bridge && node --test test/task-model.test.js test/task-store.test.js test/routing.test.js test/runtime-compatibility.test.js`
- [ ] **Step 2: Run the full bridge suite**
  - Run: `cd extensions/codex-bridge && npm test`
- [ ] **Step 3: Run static checks**
  - Run: `cd extensions/codex-bridge && npm run check`
- [ ] **Step 4: Update protocol docs after behavior is green**
  - Document owner as internal-only.
  - Document natural-language approval, denial, keep-gate-open, and fallback slash command behavior.
- [ ] **Step 5: Perform manual Feishu smoke tests**
  - Case A: plain-text normal continuation still feels native.
  - Case B: approval + “同意” resumes successfully.
  - Case C: approval + “同意，并把结果总结成三句话” forwards only the tail.
  - Case D: approval + “为什么要审批？” keeps the gate open and explains.
  - Case E: approval + “不要执行” returns to safe replan state.
  - Case F: `/codex status` during approval does not clear approval ownership.

## Rollout Notes

- Do not touch unrelated OpenClaw shim work, bootstrap scripts, or host-level service logic in this phase.
- Keep bridge chatter short; this phase is about correct flow ownership first, not richer cards or UI polish.
- If implementation discovers a legitimate `abort_task` approval call site is absent, keep support in helper logic but only wire live flows to `await_user_replan`.

## Guardrails

- Do not let approval interpretation become a general “guess what the user meant” layer.
- Do not forward approval-owned replies to Codex before bridge decides whether they authorize.
- Do not make `/codex approve <token>` the primary documented path again.
- Do not mutate owner as a side effect of read-only fallback commands.
