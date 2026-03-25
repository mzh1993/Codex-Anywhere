# Bridge-Owned Control Plane Design

- Date: 2026-03-25
- Stage: approved design

## Goal

Define a clean product boundary where normal remote work stays as close as possible to native Codex conversation, while repository-owned host control-plane actions are handled directly by the bridge instead of being forwarded back into Codex task execution.

## First Principle

渠道不决定执行语义。

The same Feishu DM is only an entry point. It must not force all actions into one execution model.

## Problem Statement

Current behavior still mixes two different kinds of work:

- normal Codex task semantics
- bridge / host control-plane semantics

That mixing creates unstable outcomes for actions like restarting the bridge-hosting service:

- sometimes the action is interpreted as a risky task and forwarded to Codex
- sometimes Codex tries to execute it inside its own constrained environment
- sometimes the result is a long explanation instead of a stable control-plane result

This violates the desired product direction:

- bridge should feel invisible during normal work
- bridge should own only the boundaries that are truly its own
- user burden should stay minimal

## Approved Core Separation

### 1. `codex task`

`codex task` is the main product object.

It owns:

- natural-language work requests
- session continuity
- cwd continuity
- summary / changed files / next steps
- continue / resume semantics

### 2. `bridge action`

`bridge action` is a boundary object, not a main work object.

It owns:

- repository-owned host control-plane actions
- approval for those actions
- direct bridge execution after approval
- a minimal one-shot result

It does **not** own:

- Codex session continuity
- Codex work summaries
- Codex task resume semantics

## V1 Scope of `bridge action`

V1 keeps this scope intentionally narrow.

Bridge-owned actions include only repository-owned control-plane actions such as:

- `openclaw-codex-feishu.service` status / start / stop / restart
- repository-owned gateway / runner health checks
- repository-owned install or lifecycle actions such as `install-systemd`
- small read-only control-plane diagnostics that describe this repository’s bridge instance

V1 explicitly excludes:

- arbitrary host `systemctl` control
- general system administration
- generic Docker / PM2 / supervisor operations
- broad host filesystem operations

## Approved Ownership Rule

The bridge should directly execute a control-plane action only when the bridge clearly owns that action’s semantics.

That means:

- a normal work request stays with Codex
- a repository-owned control-plane request stays with bridge
- bridge should not “helpfully” consume inputs that still belong to Codex

In short:

**ordinary work belongs to Codex; repository-owned control-plane actions belong to bridge.**

## Owner Routing Rule

Internal routing should distinguish between:

- `owner=codex`
- `owner=bridge_approval`
- `owner=bridge_action`

These are internal routing states, not user-facing concepts.

### Routing order

1. If the current interaction is waiting on bridge-owned approval, route to `bridge_approval`.
2. Otherwise, if the new request clearly matches the V1 `bridge action` scope, create a `bridge action`.
3. Otherwise, route to `codex`.

### Hard rule

If bridge does not clearly own the next input, it should let Codex own it.

## Continuity Rule

`bridge action` and `codex task` may share the same DM, but they must not share the same continuity object.

That means:

- a `bridge action` must not occupy a Codex session
- a `bridge action` must not overwrite Codex summary / next steps
- a completed `bridge action` must not alter the user’s current Codex task continuity

The DM is shared.

The execution semantics are not.

## Minimal State Model for `bridge action`

`bridge action` should use a much lighter model than `codex task`.

V1 should keep only:

- `created`
- `awaiting_approval`
- `running`
- `finished`

It should not introduce:

- task-style session continuity
- continue / resume semantics
- task-style multi-section summaries
- noisy internal progress event streams

## User Language Rule

Natural language remains the main path.

Users should be able to say:

- `请重启 openclaw-codex-feishu.service`
- `同意`
- `不要执行`
- `继续刚才那个任务`

Slash commands remain fallback controls only.

Examples:

- `/codex status`
- `/codex abort`
- `/codex approve <token>`

These must not become the default interaction path.

## Visibility Rule

Bridge should surface only when it must own a boundary.

Normal work should still feel like talking to remote Codex.

For `bridge action`, user-facing output should stay minimal:

- one short explanation when approval is needed
- one short execution acknowledgment if necessary
- one short completion result

The bridge should not expose internal ids or protocol objects unless the user explicitly enters a fallback / debugging path.

## Clarification Rule

Bridge may clarify only when it already owns the current boundary semantics.

Examples:

- approval explanation during `bridge_approval`
- short control-plane clarification during `bridge_action`

Bridge should not pre-consume ambiguous normal work requests that could belong to Codex.

If the bridge does not clearly own the semantics, it should forward to Codex instead of stealing the turn.

## Non-Goals

This design does not attempt to:

- build a generic remote operations console
- replace Codex as the task executor
- unify every action into one state machine
- expose bridge-specific concepts as a primary user model

## Acceptance Criteria

The design is successful when:

- normal work still feels like native Codex conversation
- repository-owned control-plane actions no longer rely on Codex trying to execute them
- approval remains natural-language-first
- bridge-owned control-plane actions do not pollute Codex task continuity
- user reading burden decreases instead of increasing
