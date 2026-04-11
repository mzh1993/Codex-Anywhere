# V1 Closure Roadmap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close V1 in the right order: first same-origin reply-plane closure, then task-lane stability, then generalized deployment, without reopening command-surface or bridge-thickness debates.

**Architecture:** Treat this as a three-wave closure program, not one giant feature. Wave 1 closes the result loop, Wave 2 closes continuity and observability stability, Wave 3 closes cross-machine installation and operator clarity. Each wave must complete contract → tests → implementation → grey replay before the next wave begins.

**Tech Stack:** Node.js ESM, built-in `node:test`, existing bridge runtime/persistence modules, Bash/PowerShell installers, Markdown governance docs

---

### Task 1: Freeze the execution order and reuse the right detailed plans

**Files:**
- Modify: `docs/superpowers/specs/2026-04-04-v1-closure-roadmap-design.md`
- Create: `docs/superpowers/plans/2026-04-04-v1-closure-roadmap-implementation.md`
- Reference: `docs/superpowers/plans/2026-04-04-reply-plane-phase1-implementation.md`
- Reference: `docs/superpowers/plans/2026-04-04-primary-deliverable-and-grey-story-replay.md`
- Reference: `docs/superpowers/plans/2026-04-04-reply-plane-grey-regression-hardening.md`
- Reference: `docs/superpowers/plans/2026-04-02-task-continuity-after-bridge-restart.md`
- Reference: `docs/superpowers/plans/2026-04-02-running-card-liveness.md`
- Reference: `docs/superpowers/plans/2026-04-02-revive-task-lane-tool.md`

- [ ] **Step 1: Freeze the wave order**

Record that execution must proceed in this order only:

1. Wave 1: reply-plane closure
2. Wave 2: continuity and observability stability
3. Wave 3: deployment generalization

- [ ] **Step 2: Mark pre-existing plans as wave inputs instead of parallel side quests**

Treat the existing reply-plane and continuity plans as building blocks for the three waves, not as independent workstreams to run in parallel.

- [ ] **Step 3: Define the wave gate**

State explicitly that a wave cannot be called closed until:

```text
- contract is aligned
- targeted tests are green
- real grey-story replay is green
- docs/readme are aligned with the landed behavior
```

### Task 2: Wave 1 plan — close the reply plane

**Files:**
- Modify: `docs/contract-matrix.md`
- Modify: `README.md`
- Modify: `extensions/codex-bridge/lib/codex-exec.js`
- Modify: `extensions/codex-bridge/lib/reply-plane.js`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/test/codex-exec.test.js`
- Modify: `extensions/codex-bridge/test/reply-plane.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Create: `extensions/codex-bridge/test/fixtures/grey-stories/2026-04-04-image-request-primary-only/last-message.txt`

- [ ] **Step 1: Finish the missing replay fixture and make the current reply-plane suite runnable**

Close the existing test residue first by adding the missing grey-story fixture and ensuring the current `reply_plane` runtime assertions can run deterministically.

- [ ] **Step 2: Merge the three existing reply-plane subplans into one closure pass**

Execute, in one wave:

```text
- same-origin manifest return
- primary-deliverable-only default
- finish-card transport safety and svg downgrade
```

Do not split these into separate user-visible release claims.

- [ ] **Step 3: Add a final reply-plane grey acceptance replay**

Replay at least these real user stories:

```text
- user asked for one image, bridge returns only that image
- summary still returns when one deliverable fails
- finish card does not duplicate deliverable inventory
```

- [ ] **Step 4: Align README after runtime truth is green**

Once the wave is green, ensure [README.md](/media/mzh/2TB1/codex_feishu/README.md) describes the current reply-plane behavior exactly and does not over-promise redirect or smart artifact discovery.

- [ ] **Step 5: Wave 1 verification**

Run:

```bash
node --test extensions/codex-bridge/test/codex-exec.test.js --test-name-pattern='reply_plane|delivery manifest|primary deliverable'
node --test extensions/codex-bridge/test/reply-plane.test.js
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='reply_plane|primary deliverable|finish_summary'
git diff --check
```

Expected: reply-plane closure is green with no missing-fixture failures.

### Task 3: Wave 2 plan — close continuity and observability stability

**Files:**
- Modify: `docs/contract-matrix.md`
- Modify: `docs/feishu-codex-bridge-v1.md`
- Modify: `extensions/codex-bridge/index.js`
- Modify: `extensions/codex-bridge/lib/task-store.js`
- Modify: `extensions/codex-bridge/test/task-store.test.js`
- Modify: `extensions/codex-bridge/test/persistence-reliability.test.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`
- Modify: `tools/revive-task-lane.mjs`
- Modify: `tools/lib/revive-task-lane-core.mjs`
- Modify: `tools/test/revive-task-lane.test.mjs`

- [ ] **Step 1: Unify continuity around the task lane**

Make `task` the only continuity anchor for:

```text
- plain-text continuation
- approval completion
- bridge/gateway restart recovery
- manual revive operations
```

- [ ] **Step 2: Close long-task observability as part of the same wave**

Do not treat card liveness as a separate polish stream. Finish within this wave:

```text
- one running card
- bounded silence
- same-card finish
- deduped status text
- compact heartbeat copy
```

- [ ] **Step 3: Promote revive-task-lane to a formal internal recovery tool**

Keep it repo-local only, but make it part of the continuity closure discipline so “manual revive” is no longer an ad-hoc repair path.

- [ ] **Step 4: Add a continuity grey replay pack**

Replay at least:

```text
- restart after long task, next plain text continues same lane
- approval during active task keeps same lane
- stale/missing activeTaskId recovers from lastTaskId without lane drift
```

- [ ] **Step 5: Wave 2 verification**

Run:

```bash
node --test extensions/codex-bridge/test/task-store.test.js
node --test extensions/codex-bridge/test/persistence-reliability.test.js
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='restart|continuity|progress card|running'
node --test tools/test/revive-task-lane.test.mjs
git diff --check
```

Expected: continuity and observability guarantees hold without task-id drift or running-card spam.

### Task 4: Wave 3 plan — close generalized deployment

**Files:**
- Modify: `README.md`
- Modify: `docs/deployment-p1-cross-platform.md`
- Modify: `scripts/install.sh`
- Modify: `scripts/install.ps1`
- Modify: `scripts/bootstrap-codex-feishu.sh`
- Modify: `extensions/codex-bridge/lib/settings.js`
- Modify: `extensions/codex-bridge/lib/locale.js`
- Modify: `extensions/codex-bridge/test/runtime-compatibility.test.js`

- [ ] **Step 1: Freeze the supported deployment contract**

Explicitly treat these as current closure targets:

```text
- Ubuntu 20.04 / 22.04
- WSL2 Ubuntu
- Windows 10 / 11 native
```

Do not expand scope to macOS in this wave.

- [ ] **Step 2: Make installer defaults platform-safe and machine-neutral**

Close remaining machine-specific assumptions in:

```text
- default cwd
- default runtime mode
- post-install health hints
- common smoke examples
```

- [ ] **Step 3: Make doctor/preflight the single operator truth**

Ensure installers, README, and deployment docs all point users to the same minimal diagnosis path:

```text
1. /codex doctor
2. install-health.json
3. host logs
```

- [ ] **Step 4: Add deployment smoke verification**

Add or update the minimal smoke contract so a fresh machine is considered “ready” only when it can:

```text
- install
- start service/host process
- answer /codex doctor
- complete one explicit /codex task to awaiting_input
```

- [ ] **Step 5: Wave 3 verification**

Run:

```bash
bash scripts/install.sh --help
powershell -ExecutionPolicy Bypass -File .\\scripts\\install.ps1 -Help
node --test extensions/codex-bridge/test/runtime-compatibility.test.js --test-name-pattern='default_cwd|doctor|native_windows_fast'
git diff -- README.md docs/deployment-p1-cross-platform.md scripts/install.sh scripts/install.ps1 scripts/bootstrap-codex-feishu.sh extensions/codex-bridge/lib/settings.js extensions/codex-bridge/lib/locale.js extensions/codex-bridge/test/runtime-compatibility.test.js
```

Expected: deployment docs, defaults, and smoke path all tell one coherent story.

### Task 5: Final closure review

**Files:**
- Verify only

- [ ] **Step 1: Re-run the experience-critical checklist**

Use [docs/experience-regression-checklist.md](/media/mzh/2TB1/codex_feishu/docs/experience-regression-checklist.md) to replay:

```text
- continuous task
- approval
- restart recovery
- long-task observability
- reply-plane return
- first-install smoke path
```

- [ ] **Step 2: Re-read top-level docs against landed behavior**

Re-check:

```text
- README.md
- docs/feishu-codex-bridge-v1.md
- docs/product-decision-baseline.md
- docs/contract-matrix.md
```

Expected: no top-level promise exceeds runtime truth.

- [ ] **Step 3: Close only when all three waves are green**

Do not declare V1 closed if only one or two waves are complete.
