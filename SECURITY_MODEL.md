# Security Model

> Alpha document. Describes current boundaries and current gaps. Not a formal threat-model report.

## Core Principle

Channel integrations must not define execution semantics.

The product being built here is a safe execution core for Codex-driven remote work. Feishu is the first control plane. OpenClaw is the current transport shell. Neither should be the source of truth for task meaning, approval meaning, or execution boundary meaning.

## Current Guarantees

- One active task per user
- One task may span multiple serial runs
- Stable task statuses and run statuses
- Approval-required actions block the current run and require explicit approval before the next run
- Denied actions do not silently continue; they return the task to `awaiting_input`
- The bridge executes with an isolated `HOME` / `CODEX_HOME`
- The bridge forwards only an allowlisted environment subset into `codex exec`
- The bridge uses a repository-scoped state root rather than the host global OpenClaw state

## Current Boundary Model

The current safety boundary is implemented at the bridge policy and execution-wrapper layer.

Today that means:

- isolated runner state
- isolated Codex home
- approval gating for selected high-risk actions
- denial of selected out-of-boundary actions
- auditable task/run persistence

This is already useful, but it is not yet the final form of a controlled runner.

## Current Non-Guarantees

The repository does **not** yet guarantee:

- complete system-boundary enforcement at the operating-system level
- mature process ownership / lease semantics across all crash and restart cases
- comprehensive multi-tenant isolation
- complete protection against model-generated boundary probing
- production-grade audit tooling and incident workflow

In other words: this repository is an alpha safe-runner core, not a finished secure execution platform.

## Approval and Denial Semantics

- `approval_required` means the requested action is still inside the product capability domain, but requires explicit user authorization
- `denied` means the requested action is outside the product capability domain or would violate current safety assumptions
- Approval creates a new run; it does not resume the old blocked run
- Denial normally returns the task to `awaiting_input`, allowing the user to restate the request inside allowed boundaries

## Recovery Semantics

- If the bridge restarts and finds a stale persisted `running` task with no live runtime entry, it recovers that task to `awaiting_input`
- The user must then continue explicitly with `/codex continue <prompt>`
- Heartbeat silence is currently observational only; it is not treated as authoritative proof that a run has died

## Transport Scope

Feishu currently provides:

- inbound input
- task status display
- approval interaction
- result delivery

OpenClaw currently provides:

- Feishu transport integration
- pairing and shell infrastructure reuse

Neither transport layer should redefine:

- task continuity
- approval semantics
- denial semantics
- execution boundaries

## Known Gaps

The next major hardening areas are:

- stronger execution-boundary enforcement beyond prompt/path policy checks
- runtime ownership and liveness recovery (`lease` / `epoch` style semantics)
- richer auditability and operator tooling
- better integration-level verification across restart and failure scenarios

## Public Usage Guidance

This repository is suitable for:

- alpha collaboration
- design review
- early operator experimentation
- protocol and safety-boundary iteration

This repository is not yet suitable for:

- production unattended hosting
- high-assurance remote execution claims
- multi-tenant security-sensitive deployment
