# Safe Runner Core Design

## Status

- Date: 2026-03-24
- Scope: product definition and core protocol skeleton
- Stage: approved design, revised with task/run split

## One-Line Definition

This repository is a Feishu-first safe execution core. It currently uses OpenClaw as the transport shell for Feishu, but channel integrations must not define execution semantics.

## Product Intent

The product being built here is not a chat bridge and not an OpenClaw-centric plugin product. Its primary value is a controlled execution core for Codex-driven remote work, with explicit task semantics, approval boundaries, and auditability.

Feishu is the first control plane. OpenClaw is the current Feishu transport shell. Both are important, but neither is the source of truth for task meaning, policy meaning, or approval meaning.

## Primary Principles

1. Channel must not determine execution semantics.
2. The core defines task, status, approval, and policy behavior before any rich Feishu interaction is designed.
3. OpenClaw is the current transport shell, not the product core.
4. High-risk but in-scope actions pause for approval; out-of-scope or boundary-breaking actions are denied.
5. Every intercepted action must return a stable policy reason code, not only natural-language text.
6. A user may have only one active task at a time.
7. A task is a continuous user goal; a run is one execution attempt within that task.

## Product Shape

### Core Product

- Safe execution core
- Task-centric protocol
- Explicit approval model
- Auditable task lifecycle

### First Delivery Surface

- Feishu-first control plane
- Minimal user-visible outputs:
  - text
  - status
  - approval

### Explicit Non-Goals for This Phase

- Multi-IM platform abstraction as a first-class product goal
- Rich artifact protocol for images/files/graphs in the first stable core
- Letting Feishu interaction affordances reshape core task semantics
- Treating the repository as only an OpenClaw plugin extension

## Core Domain Model

### Task

`task` is the primary object. A task represents one user goal being advanced by the execution core.

The system is task-centric rather than message-centric or transport-centric.

Tasks are continuous. A task may span multiple execution attempts, multiple user inputs, and multiple approval points.

### Task Event

`task_event` records user input or system transitions attached to a task. Examples include:

- task created
- user continue input
- approval requested
- approval granted
- task completed

`/codex continue` is modeled as a new input event on the same task, not a new task.

### Run

`run` is one concrete execution attempt inside a task. A task may own multiple runs, but only serially, never as parallel active runs.

This split is required because:

- approvals break one execution attempt into multiple segments
- ordinary follow-up input should continue the same task without pretending it is the same uninterrupted run
- task continuity and run auditability must both remain explicit

### Task Status

The first stable task status set is:

- `created`
- `running`
- `awaiting_input`
- `awaiting_approval`
- `completed`
- `aborted`

These statuses are protocol-level states, not just display labels.

Default rule:

- `run` completion does not automatically imply `task` completion
- unless the system can explicitly conclude the user goal is finished, the task returns to `awaiting_input`

### Run Status

The first stable run status set is:

- `running`
- `completed`
- `failed`
- `aborted`
- `blocked`

`blocked` means this specific execution attempt stopped because further user input or approval is required before the same task can continue.

### Approval

`approval` belongs to a task. It is not an independent task. It is a blocking point within a task lifecycle where the system stops advancing until the user decides.

Approval blocks a run, not the task itself. The task remains active and waits for the user.

### Policy Decision

Every candidate action is classified as one of:

- `allowed`
- `approval_required`
- `denied`

These are capability-domain decisions, not merely risk scores.

### Policy Reason Code

When an action is intercepted, the core must return a stable reason code. Reason codes are part of the protocol and must remain valid across languages and channels.

### Run Record

`run_record` captures a run, including logs, summary, and exit outcome. It supports a task but does not replace task identity.

## Task / Run Lifecycle

### Task Main Flow

- new task -> `created`
- first run starts -> `running`
- run blocks on approval -> `awaiting_approval`
- approval granted -> next run starts -> `running`
- run ends and user input is needed -> `awaiting_input`
- next input arrives -> next run starts -> `running`
- user explicitly ends the work / system can conclude work is finished -> `completed`
- user termination -> `aborted`

### Run Main Flow

- run starts -> `running`
- approval needed -> `blocked`
- normal finish -> `completed`
- execution error -> `failed`
- user termination -> `aborted`
- denied action -> `blocked`

### Lifecycle Rules

- a task may own multiple runs, but only one active run at a time
- `awaiting_approval` and `awaiting_input` are independent stable task states
- approval always ends the current run and creates a later run on approval grant
- any normal continue flow also creates a new run rather than resuming the old run
- `run.completed`, `run.failed`, and denied/blocking outcomes do not automatically terminate the task
- by default, after a run ends without explicit task completion, the task becomes `awaiting_input`
- terminal task states are:
  - `completed`
  - `aborted`
- denied is not a default terminal task state; denied actions normally terminate the current run and return the task to `awaiting_input`

## Single Active Task Rule

Each user may have only one active task at a time. Active statuses are:

- `created`
- `running`
- `awaiting_input`
- `awaiting_approval`

This rule is chosen to preserve continuity, reduce cognitive load in IM, and keep approval and status routing unambiguous.

## Input Routing Rules

### When No Active Task Exists

- plain text creates a new task
- `/codex continue` is rejected because there is no active task to continue

### When An Active Task Exists

- if the task is `awaiting_input`, plain text is treated as the next continue input for that task
- if the task is `running` or `awaiting_approval`, plain text does not implicitly continue the task
- `/codex continue <text>` appends explicit input to the active task and creates the next run
- `/codex approve <token>` acts on the active task approval point
- `/codex abort` aborts the active task
- `/codex status` reports the active task

The protocol must not guess freely. Plain text is only auto-routed to continue when the active task is explicitly in `awaiting_input`. In all other active-task states, routing remains explicit.

## Policy Model

### Allowed

The action is inside the product capability domain and may execute immediately.

### Approval Required

The action is still inside the product capability domain, but requires explicit user authorization before continuing the same task.

This transition blocks the current run and moves the task into:

- `running -> awaiting_approval`

### Denied

The action is outside the product capability domain or would break the safety assumptions of the system. It cannot be bypassed by approval.

Default denial behavior:

- the current run stops
- the denied action is recorded with a stable reason code
- the task returns to `awaiting_input` so the user can restate the request inside allowed boundaries

If the product later needs a stronger terminal denial mode, that should be introduced explicitly rather than overloaded onto the base task model.

## Stable Reason Codes

The initial reason-code set should stay small and focus on safety and boundary interception.

### Approval Codes

- `host_mutation_requires_approval`
- `service_control_requires_approval`
- `global_env_change_requires_approval`
- `destructive_change_requires_approval`

### Denial Codes

- `isolation_boundary_denied`
- `transport_mutation_denied`
- `policy_bypass_denied`
- `out_of_scope_admin_denied`

These names are intentionally channel-neutral and locale-neutral.

## Feishu Role

Feishu is the first control plane, not the source of execution truth.

Feishu is responsible for:

- receiving user input
- showing current task status
- showing run progress inside the current task
- carrying approval interactions
- presenting final results and minimal key progress updates

Feishu is not responsible for:

- defining task meaning
- deciding whether an action is allowed, approval-required, or denied
- redefining continue semantics

Rich Feishu interaction may grow later, but it must remain an adapter over the core protocol.

## OpenClaw Role

OpenClaw is the current transport shell and infrastructure reuse layer for Feishu integration. It is valuable and should continue to be used in the near term, especially when tracking official `openclaw-lark` evolution.

However, OpenClaw is not the product core. The repository should not let OpenClaw define:

- task model
- approval semantics
- policy semantics
- safe execution boundaries

The desired long-term architecture is:

- core protocol and execution boundaries owned here
- Feishu transport currently delivered via OpenClaw
- future transport replacement possible without changing task semantics

## Evolution Priorities

### Priority 1: Fix Core-Breaking Issues

Address implementation issues that violate the intended core model:

- subprocess environment leakage
- incorrect `continue` cwd semantics
- prompt-string-based policy gating

### Priority 2: Extract First-Class Core Objects

Make the following concepts explicit in code and storage rather than leaving them diffused across bridge logic:

- task
- task event
- run
- run record
- task status
- approval
- policy decision
- policy reason code

### Priority 3: Improve Feishu As Control Plane

Only after core semantics stabilize should the system expand richer Feishu presentation such as:

- approval buttons
- richer status cards
- better progress presentation

## Implementation Status

- First core fixes are in place: env allowlist, isolated `HOME`, and explicit resume cwd semantics
- Task/run split is implemented in bridge storage and lifecycle handling
- Current routing contract is implemented: one active task per user, `awaiting_input` plain-text auto-continue, explicit `/codex continue`, approval creates a new run
- Stable protocol values now exist for task statuses, run statuses, policy decisions, and reason codes

## External References Considered

- `https://github.com/op7418/Claude-to-IM-skill`
- `https://github.com/Johnixr/claude-code-wechat-channel`
- `https://github.com/larksuite/openclaw-lark`

These references helped clarify what this repository should not become:

- not primarily a generic multi-IM bridge
- not primarily a host-ecosystem plugin product

## Summary

The next stage of this repository should turn the current V1 prototype into an execution-core-first system. The immediate goal is not adding more channel features. It is to tighten boundaries, stabilize protocol semantics, and reduce dependence on transport-specific behavior.
