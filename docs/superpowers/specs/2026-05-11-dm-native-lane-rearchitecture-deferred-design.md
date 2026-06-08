# DM-Native Lane Re-Architecture Deferred Design

> Status: suspended / deferred. This document records the latest product-direction analysis, but it is not approved for implementation in the current phase.

## Summary

This document records a newly explored product direction:

- remove OpenClaw as the transport shell
- switch Feishu private chat to direct claim by default
- change the top-level continuity model from `task/run` to DM-bound persistent `lane/run`
- simplify the user-visible command surface to:
  - plain DM text = continue current lane
  - `/codex <prompt>` = start a native new session
  - `/codex --cd <path> <prompt>` = start a native new session in a target workspace

After analysis against the current repository, this direction is judged product-meaningful but too risky to execute in the current phase. It is therefore documented and explicitly deferred.

## Current Implemented Design

The repository currently implements this model:

- Feishu is the primary closed-loop surface, but the bridge stays thin.
- OpenClaw is the current transport shell, pairing shell, lifecycle host, and isolated gateway ops shell.
- Private chat claim is gated by paired DM semantics.
- The continuity model is `task/run`, not DM-long-lived `lane/run`.
- Plain text is the main path only after a task is already active or recoverable.
- Explicit control surface is still centered on:
  - `/codex --cd <path> <prompt>`
  - `/codex resume <prompt>`
  - `/codex doctor`

This current behavior is reflected in:

- [README.md](/media/mzh/2TB1/codex_feishu/README.md)
- [docs/feishu-codex-bridge-v1.md](/media/mzh/2TB1/codex_feishu/docs/feishu-codex-bridge-v1.md)
- [docs/contract-matrix.md](/media/mzh/2TB1/codex_feishu/docs/contract-matrix.md)

## Proposed New Design

The explored replacement direction is:

- DM-first direct claim:
  - any private chat may directly enter the main path
  - group chat remains deny-by-default unless explicitly allowlisted
- persistent DM lane:
  - each DM owns one default long-lived lane/thread
  - plain text always continues that lane
  - even after a completed run, the next plain message still continues the same lane
- explicit new-session only surface:
  - remove user-visible `/codex resume`
  - do not reintroduce `/reset`
  - `/codex <prompt>` means a native new session
  - `/codex --cd <path> <prompt>` means a native new session in a specific cwd
- DM-scoped remembered `full_access` remains, but attaches to DM origin rather than paired-DM continuity

## Why The New Design Is Attractive

Relative to the current repository, the new design has real product advantages:

1. It aligns more cleanly with the north star in [docs/product-north-star.md](/media/mzh/2TB1/codex_feishu/docs/product-north-star.md): Feishu private chat becomes the low-cognitive-load remote Codex surface, not a paired gate plus task shell.
2. It reduces bridge-visible ceremony:
   - no pairing step before first real use
   - no visible `resume` command
   - no user-facing reset shell
3. It makes the product feel closer to native Codex:
   - plain text continues
   - `/codex ...` explicitly starts a new session
4. It removes one major source of bridge-specific product drift:
   - the current paired-DM gate is useful for safety, but it is still a bridge-native concept rather than a Codex-native concept

## Why The New Design Is Not Being Executed Now

Relative to this repository's current implementation, the new design is not a small refinement. It is a product-boundary rewrite plus a transport-host rewrite.

### 1. It breaks the current continuity object model

The repository currently centers continuity around `task/run`.

The new design requires:

- replacing top-level `task` meaning with long-lived DM `lane/thread`
- redefining `completed` from "task lifecycle end" to "last run finished"
- rewriting recovery, restart, approval resume, and persistence assumptions

This directly impacts current storage and runtime concepts such as:

- `profile.activeTaskId`
- `profile.lastTaskId`
- task status transitions
- run attachment to a short-lived task object

### 2. It removes an existing entry boundary without a drop-in replacement

The current paired-DM gate is not just a UX step. In this repository it is also an entry-boundary rule and part of the current trust model.

Moving to direct DM claim means:

- any user who can private-message the bot may enter the execution path
- the previous "paired DM" trust boundary disappears
- claim policy, DM trust semantics, and audit interpretation all need to be rewritten

This directly affects current governance rows such as:

- `PB-008`
- `PM-004`
- `CT-002`

in [docs/contract-matrix.md](/media/mzh/2TB1/codex_feishu/docs/contract-matrix.md).

### 3. It cannot be achieved by "just enabling ws"

The repository already contains an experimental `ws` execution backend, but that backend is currently only a thin `codex --remote ...` wrapper. It is not a full replacement for the current transport shell.

Current facts:

- OpenClaw currently provides plugin hosting, Feishu helper functions, DM pairing shell, lifecycle hooks, and isolated gateway ops shell.
- the current ws backend does not replace those responsibilities
- OpenAI's current `codex app-server` websocket transport is still marked experimental

So "remove OpenClaw" and "use Codex ws" are not the same project.

### 4. It would stack too many risky changes at once

If executed now, the new direction would combine:

- transport host replacement
- entry-boundary rewrite
- continuity model rewrite
- command-surface rewrite
- possible execution-backend change

That is too much simultaneous semantic movement for the current phase.

## Old Design vs New Design In This Repository

### Current implemented design: strengths

- already integrated into current code, docs, tests, and contract matrix
- safer and narrower entry boundary because of paired-DM claim
- stable `task/run` model already has persistence, approval, and recovery proof
- OpenClaw currently absorbs transport, lifecycle, and ops complexity
- lower execution risk for the current `P0-收口 IV` stage

### Current implemented design: weaknesses

- more bridge-visible ceremony than the product north star ideally wants
- explicit `/codex resume` remains a bridge-exposed continuation concept
- paired DM is a product friction point before first use
- continuity feels more like "remote task runner" than "remote native Codex thread"

### New design: strengths

- more faithful to the low-cognitive-load Feishu-native Codex product direction
- cleaner command surface
- plainer continuity story for users
- stronger "Codex is the only main actor" feel

### New design: weaknesses

- much larger semantic and implementation blast radius
- weaker default entry boundary than paired-DM gating
- requires transport-host replacement, not just execution-backend replacement
- creates deferred product debt around multi-lane history discoverability and lane switching
- pushes more lifecycle and safety responsibility into repository-owned code

## Old Design vs New Design Comparison Table

| Area | Current implemented old design | Explored new design | Repository-level implication |
| --- | --- | --- | --- |
| Entry | private chat claim is gated by paired-DM semantics; group chat is deny-by-default unless allowlisted | any private chat directly enters the main path; group chat stays deny-by-default unless allowlisted | new design removes one current trust gate and requires a new direct-claim policy baseline |
| Permissions | remembered `full_access` is DM-scoped, but currently tied to paired-DM continuity and current task/resume surface | remembered `full_access` stays DM-scoped, but would attach to DM origin plus persistent lane semantics | permission memory can stay conceptually similar, but the host object for that memory changes |
| Continuity | top-level continuity is `task/run`; plain text resumes only when a current task is active or recoverable | top-level continuity becomes DM-bound persistent `lane/run`; plain text always continues the DM default lane, including after completed runs | this is the biggest semantic rewrite because current persistence, recovery, and state naming all assume `task/run` |
| Command surface | user-visible main surface is plain text + `/codex --cd <path> <prompt>` + `/codex resume <prompt>` + `/codex doctor` | user-visible main surface becomes plain text + `/codex <prompt>` + `/codex --cd <path> <prompt>` + `/codex doctor`; no user-visible `resume` or `reset` | new design is cleaner for users, but requires rewriting help text, routing rules, tests, and current protocol docs |
| Persistence | current stores and profile continuity center on `activeTaskId`, `lastTaskId`, task statuses, and run records attached to short-lived tasks | persistence would need a DM-long-lived lane/thread object above runs; completed no longer means the top-level object ends | storage shape and recovery rules would need deliberate redesign, not just field renaming |
| Migration cost | already implemented and proven by current docs, contract matrix, and tests | requires transport-host replacement, continuity-model rewrite, command-surface rewrite, contract-matrix rewrite, and migration planning for existing stored state | high migration cost with large semantic surface; not appropriate as a current-phase implementation change |

## Decision

The repository should not implement the new design in the current phase.

Decision:

1. Keep the currently implemented old design as the active repository definition.
2. Keep the current `task/run` continuity model active.
3. Keep OpenClaw as the current transport shell for now.
4. Keep `/codex resume <prompt>` as part of the active current command surface for now.
5. Record the DM-native lane redesign as a deferred direction only.

## Revisit Conditions

This deferred design should be revisited only after all of the following are true:

1. the current reply-plane and feedback-loop closure work is stable
2. direct Feishu transport replacement is explicitly chosen as a new phase
3. Codex version re-verification is completed against the actual host baseline
4. the repository is ready to absorb a continuity-model rewrite from `task/run` to `lane/run`

Until then, this document is analytical only and must not be treated as an implementation-ready spec.
