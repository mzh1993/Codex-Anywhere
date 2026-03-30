# Bridge Contract Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hard-close the remaining gap between the thin-bridge contract and the implementation for explicit entry, true reset semantics, and legacy command closure.

**Architecture:** Keep the bridge dumb and narrow. Tighten docs and tests around the existing native-first `/codex` surface, then make the runtime reject any lingering historical command/session behavior that contradicts that contract.

**Tech Stack:** Node.js, built-in `node:test`, OpenClaw plugin runtime, Markdown docs.

---

### Task 1: Lock contract wording

**Files:**
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `README.md`

- [ ] Align wording so approval is explicitly limited to the thin pre-run gate under explicit bridge entry or bridge-owned control loops.
- [ ] Remove any wording that implies historical compatibility commands still belong to the contract.
- [ ] State that saying “new session” must map to a fresh execution lane, not only a chat-shell reset.

### Task 2: Add failing contract tests

**Files:**
- Modify: `extensions/codex-bridge/test/routing.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] Add a routing/contract test that ordinary text mentioning protected roots or model knobs still stays on the Codex lane unless it uses explicit `/codex ...`.
- [ ] Add a runtime test that historical `/codex` subcommands stay closed and do not mutate task/session state.
- [ ] Run the targeted tests and confirm at least one new assertion fails before implementation changes.

### Task 3: Patch runtime behavior

**Files:**
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/command-fallback-router.js`
- Modify: `extensions/codex-bridge/lib/task-model.js` (only if required by failing tests)

- [ ] Make the runtime return native-first closure for any remaining historical `/codex` commands without mutating bridge state.
- [ ] Ensure explicit `/codex` entry is the only bridge-owned task start surface apart from approval/control loops.
- [ ] Keep the implementation minimal and aligned with the existing thin-bridge architecture.

### Task 4: Verify

**Files:**
- Test: `extensions/codex-bridge/test/routing.test.js`
- Test: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] Run the targeted test files.
- [ ] If green, summarize the exact contract delta and remaining non-goals.
