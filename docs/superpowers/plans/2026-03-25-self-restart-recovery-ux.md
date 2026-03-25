# Self-Restart Recovery UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make bridge self-restart interruptions recover with a specific, low-burden user message instead of the generic `run.interrupted` wording.

**Architecture:** Keep the current task / run persistence model and stale-run recovery flow. Add one narrow interruption-hint override for the specific case where the approved action targets the bridge-hosting service unit; all other interruption cases stay on the existing generic recovery path.

**Tech Stack:** Node.js ESM, existing `codex-bridge` modules, built-in `node:test`.

---

## File Map

- Modify: `extensions/codex-bridge/index.js`
  - Detect when a recovered stale run likely came from restarting the bridge-hosting service.
- Modify: `extensions/codex-bridge/lib/task-store.js`
  - Accept a recovery interruption-hint override when normalizing stale running tasks.
- Modify: `extensions/codex-bridge/lib/locale.js`
  - Add a concise localized message for bridge self-restart recovery.
- Modify: `extensions/codex-bridge/lib/settings.js`
  - Add a small config hook for bridge-hosting service unit names.
- Modify: `extensions/codex-bridge/openclaw.plugin.json`
  - Expose the new optional config field in schema / UI hints.
- Modify: `config/openclaw.codex-feishu.json5`
  - Seed the default bridge service unit name for this repo instance.
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
  - Reproduce the current user-facing stale recovery wording as a failing test first.
- Modify: `extensions/codex-bridge/test/task-model.test.js`
  - Lock localized output for the new interruption hint.
- Modify: `extensions/codex-bridge/test/task-store.test.js`
  - Lock the stale-run recovery override behavior.
- Modify: `docs/feishu-codex-runner-v1.md`
  - Sync recovery semantics.

## Scope

- In scope:
  - one special recovery hint for bridge self-restart
  - optional config for bridge-hosting service unit names
  - tests and docs for this exact UX case
- Out of scope:
  - broader status taxonomy redesign
  - generic service lifecycle tracking
  - approval or routing semantics beyond this recovery message

### Task 1: Reproduce the UX gap with tests

**Files:**
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `extensions/codex-bridge/test/task-model.test.js`
- Modify: `extensions/codex-bridge/test/task-store.test.js`

- [ ] Add an end-to-end stale-recovery test for a running task whose prompt targets `openclaw-codex-feishu.service`.
- [ ] Add a locale test for the new interruption hint copy.
- [ ] Add a stale-task persistence test proving the override survives recovery.
- [ ] Run targeted tests and confirm they fail first.

### Task 2: Implement the narrow recovery hint override

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/lib/settings.js`
- Modify: `extensions/codex-bridge/openclaw.plugin.json`
- Modify: `config/openclaw.codex-feishu.json5`

- [ ] Add settings support for bridge service unit names.
- [ ] Detect the self-restart case during stale-run recovery.
- [ ] Persist the specialized interruption hint instead of the generic one.
- [ ] Keep all non-self-restart interruption flows unchanged.

### Task 3: Verify and document

**Files:**
- Modify: `docs/feishu-codex-runner-v1.md`

- [ ] Re-run targeted tests.
- [ ] Re-run full `extensions/codex-bridge` test suite.
- [ ] Re-run `npm run check`.
- [ ] Update recovery docs with the new user-visible behavior.
