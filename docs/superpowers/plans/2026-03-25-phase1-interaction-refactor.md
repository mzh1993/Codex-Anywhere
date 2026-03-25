# Phase 1 Interaction Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make natural language the default continue/recovery path and reduce bridge-visible chatter, while keeping the existing approval and isolation boundary intact.

**Architecture:** Keep the current task/run persistence model, approval gating, and policy enforcement unchanged. Only refactor the interaction layer: route plain text back into the active Codex task whenever the task is already in a safe resumable state, and shrink bridge output so users mostly read Codex content rather than bridge protocol noise. Keep `/codex ...` commands as fallback controls, not the main interaction model.

**Tech Stack:** Node.js ESM, existing `codex-bridge` modules, built-in `node:test`.

---

## Scope

- In scope:
  - default natural-language continue for `awaiting_input`
  - default natural-language recovery after interrupted runs
  - shorter active-task guidance for `running`
  - suppress or collapse low-signal bridge progress chatter
- Out of scope:
  - natural-language approval execution
  - protocol or persistence schema rewrite
  - card UI / richer status rendering
  - public docs rewrite (`README.md`, `docs/feishu-codex-runner-v1.md`)

## File Map

- Modify: `extensions/codex-bridge/lib/task-model.js`
  - Remove command-first assumptions from plain-text routing.
- Modify: `extensions/codex-bridge/lib/locale.js`
  - Rewrite user-facing guidance so bridge commands are fallback-only and internal event names do not leak.
- Modify: `extensions/codex-bridge/index.js`
  - Apply the new routing rules and reduce noisy progress / heartbeat messages.
- Modify: `extensions/codex-bridge/test/routing.test.js`
  - Lock the new natural-language routing behavior.
- Modify: `extensions/codex-bridge/test/task-model.test.js`
  - Lock status / recovery locale expectations.
- Optional modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
  - Only if needed to cover progress-event filtering behavior.

## Phase 1 Product Rules

- Plain text is the default input path unless the bridge is actively guarding a boundary.
- `awaiting_input` means “safe to continue with natural language,” even after an interrupted run.
- Bridge commands remain valid, but help text and rejection text must not force them as the main path.
- Bridge may interrupt the user only for:
  - approval
  - boundary denial
  - short recovery clarification
- Internal protocol details such as `item.completed` should never be user-visible.

### Task 1: Lock the new user-visible protocol with failing tests

**Files:**
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Test: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/task-model.test.js`

- [ ] **Step 1: Add routing tests for interrupted `awaiting_input` tasks**
  - Expect plain text to produce `continue_task` even when `requiresExplicitContinue` is currently true.
- [ ] **Step 2: Add locale tests for recovery wording**
  - Expect interruption guidance to request clarification in natural language, not require ``/codex continue <prompt>``.
- [ ] **Step 3: Add locale tests for running-task guidance**
  - Expect the reply to be short, state-aware, and fallback-command-only.
- [ ] **Step 4: Run targeted tests and confirm failure**
  - Run: `cd extensions/codex-bridge && node --test test/routing.test.js test/task-model.test.js`

### Task 2: Restore natural-language continue and recovery semantics

**Files:**
- Modify: `extensions/codex-bridge/lib/task-model.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js` (only if the persisted recovery flag needs comment or compatibility cleanup)
- Test: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/task-model.test.js`

- [ ] **Step 1: Stop rejecting plain text for interrupted `awaiting_input` tasks**
  - Keep `requiresExplicitContinue` as an internal recovery marker if needed, but do not let it block the main user path.
- [ ] **Step 2: Keep `/codex continue <prompt>` as a fallback**
  - Do not remove the command; just stop making it the mandatory primary path.
- [ ] **Step 3: Preserve guarded states**
  - `running` must still reject queue-jumping.
  - `awaiting_approval` must still remain approval-gated in Phase 1.
- [ ] **Step 4: Re-run targeted protocol tests**
  - Run: `cd extensions/codex-bridge && node --test test/routing.test.js test/task-model.test.js`

### Task 3: Reduce bridge-visible noise and internal event leakage

**Files:**
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/index.js`
- Optional modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Replace command-heavy recovery text**
  - Use wording like “上一轮执行中断，请直接说明要继续做什么” / “Previous run was interrupted; say what to continue with.”
- [ ] **Step 2: Replace verbose active-task rejection text**
  - `running`: brief hold message, with `/codex status` or `/codex abort` only as fallback.
  - `awaiting_input`: accept plain text instead of replying with a routing error.
- [ ] **Step 3: Filter low-signal progress hints**
  - Suppress raw hints such as `item.completed`.
  - Only surface bridge progress when it adds user-meaningful state.
- [ ] **Step 4: Coarsen heartbeat output**
  - Keep long-running reassurance, but avoid repetitive protocol-heavy spam.
- [ ] **Step 5: Add or update tests if progress filtering logic moves into a helper**
  - Run: `cd extensions/codex-bridge && node --test test/*.test.js`

### Task 4: Verify bridge behavior stays safe while becoming quieter

**Files:**
- Test: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/task-model.test.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Test: `extensions/codex-bridge/test/persistence-reliability.test.js`

- [ ] **Step 1: Run the full bridge suite**
  - Run: `cd extensions/codex-bridge && npm test`
- [ ] **Step 2: Run static syntax checks**
  - Run: `cd extensions/codex-bridge && npm run check`
- [ ] **Step 3: Perform a manual Feishu smoke test**
  - Case A: plain text new task
  - Case B: plain text continue after normal completion
  - Case C: plain text continue after interrupted recovery
  - Case D: plain text during `running` receives a short hold message
  - Case E: approval and boundary denial still surface explicitly

## Rollout Notes

- Do not rewrite public docs in this phase; first prove the new interaction path in code and real usage.
- After Phase 1 lands and manual smoke passes, Phase 2 should cover:
  - natural-language approval / recovery handling
  - help text and public protocol doc correction
  - tighter mapping between bridge states and native Codex phrasing

## Non-Goals and Guardrails

- Do not weaken approval boundaries just to make interaction feel smoother.
- Do not reintroduce transport-specific concepts into normal replies.
- Do not expose raw task/run/session internals unless the user explicitly asks for status/debug detail.
- Do not touch unrelated runtime hardening work in `extensions/codex-bridge/index.js` or `scripts/bootstrap-codex-feishu.sh`.
