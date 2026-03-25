# Natural-Language Approval Owner Routing Design

- Date: 2026-03-25
- Stage: approved design

## Goal

Define a bridge interaction model where normal work stays as close as possible to native Codex conversation, while approval remains a bridge-owned safety boundary that does not leak command burden to the user.

## First Principle

渠道不决定执行语义。

The bridge should disappear during normal work and surface only when it must own a boundary decision. Approval is one of those bridge-owned decisions.

## Problem Statement

The current system already proved that forcing users onto bridge commands such as `/codex continue <prompt>` creates reading and interaction burden.

However, approval is different from normal continuation:

- normal continuation belongs to Codex session semantics
- approval belongs to bridge boundary semantics

So “everything should be directly forwarded to Codex” is not correct during `awaiting_approval`.

The product therefore needs a routing rule that answers one clean question:

**who owns the next user reply right now?**

## Approved Core Model

### 1. Separate `status` from `owner`

The system should track two different concepts:

- `status`: what stage the task is in
- `owner`: who owns the next user reply

Examples:

- `status=awaiting_input`, `owner=codex`
- `status=awaiting_approval`, `owner=bridge_approval`

`status` is user-visible protocol state.

`owner` is internal routing state.

### 2. Owner routing is the first decision

The bridge must not start by guessing intent from text.

It must first route by current reply ownership:

- if `owner=codex`, the next plain-text reply belongs to Codex
- if `owner=bridge_approval`, the next plain-text reply belongs to bridge approval handling

This is the cleanest cut because it depends on state, not free-form keyword guessing.

## Owner Invariants

### 1. `owner=codex` is the default

`owner=codex` is:

- the normal steady state
- the default owner for new work
- the owner restored after approval is granted

### 2. `owner=bridge_approval` can only be set by bridge

`owner=bridge_approval` may only be written by bridge internal logic.

It cannot be written by:

- user text
- Codex output directly
- slash commands by themselves

Codex may emit content that suggests a risky operation or requests confirmation, but Codex cannot itself move the task into approval ownership. Only bridge may decide to create an approval point.

### 3. User input never changes owner directly

User replies may satisfy a bridge reply contract, but they do not mutate `owner` by themselves.

Only bridge logic may transition:

- `owner=codex -> owner=bridge_approval`
- `owner=bridge_approval -> owner=codex`

## Owner Routing Table

| Current owner | User input | First handler | Result |
| --- | --- | --- | --- |
| `codex` | plain text | Codex | Normal continuation |
| `codex` | `/codex ...` fallback command | Bridge | One control-plane response; owner stays `codex` unless bridge itself creates a pending point |
| `bridge_approval` | plain text matching approval contract | Bridge | Approve, then optionally pass remaining task semantics to Codex |
| `bridge_approval` | plain text matching deny contract | Bridge | Deny using predeclared `on_deny` behavior |
| `bridge_approval` | any other plain text | Bridge | Keep gate open, do not approve, do not deny |
| `bridge_approval` | `/codex status` / `/codex abort` / other fallback command | Bridge | Control-plane handling; owner remains `bridge_approval` unless the command explicitly terminates the task |

## Approved Approval Model

### 1. Approval is bridge-owned, not Codex-owned

During `awaiting_approval`, user messages are not directly forwarded to Codex first.

This is not because bridge wants to “take over the conversation.”

It is because the blocked object is a bridge-owned boundary decision. There is no safe principle by which Codex should be allowed to decide whether “ok”, “continue”, or “你看着办” counts as authorization.

### 2. The user still speaks natural language

User-facing behavior should still feel native:

- `同意`
- `继续执行`
- `不要执行`
- `现在卡在哪`

The bridge absorbs only the minimum required authorization semantics. It must not force the user onto tokens or bridge-heavy commands for the main path.

### 3. Approval uses a reply contract, not free guessing

When bridge creates an approval point, it must freeze a small internal contract alongside it:

- `reply_contract`
- `on_approve`
- `on_deny`

`reply_contract` defines the acceptable approval / deny structures for this exact prompt.

This means:

- `1` only counts as approve if bridge explicitly offered numbered options
- `ok` / `pass` / `是的` only count if this approval contract accepts them
- otherwise they are not authorization

The bridge should not implement a broad “guess the intent from keywords” layer.

## Minimal Classification Inside `owner=bridge_approval`

The machine should only produce four results:

1. **approve**
2. **deny**
3. **approve_with_tail**
4. **keep_gate_open**

### Approve

The reply matches the current approval contract’s approve form.

Result:

- bridge grants approval
- owner returns to `codex`
- the next run is created

### Deny

The reply matches the current approval contract’s deny form.

Result:

- bridge denies approval
- bridge executes the predeclared `on_deny`

### Approve With Tail

The reply first matches an approve form and then contains additional task semantics.

Example:

- `同意，继续执行，并把结果总结成三句话`

Result:

- bridge consumes the approval part
- bridge forwards the remaining task part into the resumed Codex run

### Keep Gate Open

All other inputs fall here.

Examples:

- `为什么要审批？`
- `现在什么情况`
- `你看着办`
- `嗯嗯`
- `1` without numbered options in the approval prompt

Result:

- do not approve
- do not deny
- do not pass through as an execution authorization
- continue the approval conversation while keeping `owner=bridge_approval`

This is the mature path for “模糊协作但不授权.”

## Deny Semantics

Rejecting an approval is not just a textual response; it must follow a predeclared branch chosen when the approval point is created.

### Required field: `on_deny`

Each approval point must freeze an `on_deny` contract before the user replies.

MVP should support only:

- `on_deny=await_user_replan`
- `on_deny=abort_task`

### `await_user_replan`

Use this when the task can remain alive after the risky step is denied.

Result:

- task returns to a safe input state
- owner becomes `codex`
- user can re-plan or provide a safer direction

In MVP this should map back to the existing user-visible continuation state rather than introducing a new `paused` state.

### `abort_task`

Use this when the denied action is essential and the task cannot safely continue.

Result:

- task is terminated
- no continuation owner remains

### Non-goal for MVP: `continue_without_action`

This should not be added in the first pass.

Whether the task can “skip the risky step and continue the rest” is often a task-topology judgment, not something bridge should guess from surface context.

## Fallback Commands

Fallback commands remain bridge-owned control-plane escapes.

### In `owner=codex`

Commands such as:

- `/codex status`
- `/codex abort`
- `/codex pwd`

should produce a one-off bridge response and then leave `owner=codex` unchanged, unless bridge itself creates a new pending point.

### In `owner=bridge_approval`

Commands such as:

- `/codex status`
- `/codex abort`

remain available, but they do not implicitly grant or deny approval unless that is the explicit meaning of the command.

## User-Visible Requirements

The user should feel:

- normal work goes straight to Codex
- risky boundaries are briefly owned by bridge
- after the boundary decision is made, the flow returns to Codex

The user should not need to think in terms of:

- tokens
- internal run ids
- owner fields
- task topology

## Files Expected In Scope

- `extensions/codex-bridge/lib/task-model.js`
- `extensions/codex-bridge/lib/locale.js`
- `extensions/codex-bridge/index.js`
- `extensions/codex-bridge/test/`

## Test Requirements

The implementation must add coverage for:

1. owner routing between `codex` and `bridge_approval`
2. approval contract matching without free-form keyword guessing
3. fallback commands not mutating owner in normal `owner=codex` flow
4. deny behavior following predeclared `on_deny`
5. approval-with-tail forwarding only the post-approval task semantics to Codex

## Non-Goals

This design does not yet define:

- card-based approval UX
- multiple simultaneous approval points per user
- a general paused-state taxonomy
- model-driven approval interpretation

## Success Criteria

This design is successful if:

- normal replies keep feeling like native Codex conversation
- approval never depends on Codex guessing authorization
- owner routing is decided by state first, not by text first
- fallback commands remain fallback-only
- deny outcomes are determined by predeclared bridge logic, not post-hoc guesswork
