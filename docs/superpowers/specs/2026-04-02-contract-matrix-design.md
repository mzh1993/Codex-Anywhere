# Contract Matrix Design

> Scope: institutionalize how top-level product constraints become executable contracts and test coverage, without thickening the runtime bridge.

## Problem

Recent regressions exposed a recurring gap:

- top-level design intent is often correct
- implementation may preserve internal state correctly
- but user-visible behavior can still be wrong

Examples of this failure mode:

- task continuity is preserved in persistence, but the user sees no visible reply
- progress-card reuse works within a run, but incorrectly leaks across runs
- platform-specific behavior is implemented, but not explicitly classified as “must match” or “allowed to differ”

This means the current review path is too loose between:

1. top-level principles
2. user-visible product contracts
3. testable implementation obligations

## Product Decision

Introduce a single development-time contract matrix that translates top-level rules into precise, test-mapped statements.

This matrix is:

- a design and review artifact
- a test-planning artifact
- a merge/readiness gate for behavior changes

This matrix is **not**:

- a runtime policy engine
- a new bridge feature surface
- a new user-visible command system
- a reason to add more semantic interpretation to ordinary Codex text

## Hard Boundary

The contract matrix must remain strictly in the development-governance layer.

It may influence:

- documentation quality
- test coverage expectations
- review checklists
- change-gate discipline

It must not directly introduce:

- new runtime branching unless already justified by product behavior
- new user commands
- thicker bridge interpretation of ordinary text
- dynamic runtime contract evaluation machinery

In short:

> The contract matrix is a development-time constraint system, not a runtime product subsystem.

## Goals

- Turn top-level constraints into concrete “true/false” product rules
- Make missing test coverage obvious during review
- Separate internal-state correctness from user-visible correctness
- Make cross-platform expectations explicit instead of implicit
- Reduce “looks fine internally, feels broken externally” regressions

## Non-Goals

- No runtime contract interpreter
- No generalized policy DSL
- No new user-facing bridge mode
- No attempt to fully replace existing protocol docs
- No giant one-shot retrofit of every historical behavior before the framework exists

## Proposed Structure

### Layer 1: Top-Level Principles

Existing top-level docs continue to define intent and rationale:

- product north star
- decision baseline
- V1 bridge behavior reference

These remain the source of truth for “why”.

### Layer 2: Contract Matrix

Add one unified matrix document, recommended path:

- `docs/contract-matrix.md`

This file defines the source-of-truth contracts for current behavior.

Each contract row must be written as a precise, testable statement.

Good example:

- “A new run created from an existing task must create a fresh progress card anchored to the latest inbound message.”

Bad example:

- “Progress cards should feel intuitive.”

### Layer 3: Test Mapping

Each contract row must declare how it is proven.

Minimum mapping fields:

- `contract_id`
- `top_level_source`
- `rule`
- `visible_to_user`
- `platform`
- `required_tests`
- `notes`

Recommended `required_tests` categories:

- `policy`
- `routing`
- `persistence`
- `presentation`
- `continuity`
- `runtime_compat`

Recommended visibility values:

- `user-visible`
- `internal-state`
- `both`

Recommended platform values:

- `cross-platform`
- `linux-only`
- `windows-only`
- `allowed-diff`

### Layer 4: Change Gate

Any change touching these areas must update the matrix if behavior meaning changes:

- product boundary
- permission boundary
- continuity
- observability
- command surface
- cross-platform semantics

If behavior changes but the contract matrix is not updated, the change is incomplete.

## Matrix Sections

The matrix should be organized into six fixed sections.

### 1. Product Boundary

Examples:

- ordinary text remains Codex-owned
- bridge only gates explicit `/codex ...` or bridge-owned approval/control loops
- legacy command closures do not re-open alternate user mental models

### 2. Permission Boundary

Examples:

- which actions are allowed
- which actions require approval
- which actions are denied
- where Windows fast mode is intentionally different

### 3. Continuity

Examples:

- when a task continues across runs
- what reset/restart must clear
- when a new visible interaction must still map to the same task

### 4. Observability

Examples:

- where the running card must appear
- when the same card must be reused
- when a fresh card is required
- bounded silence guarantees

### 5. Command Surface

Examples:

- what `/codex --cd ...` means
- what `/codex resume ...` means
- what `/codex doctor` must report
- what closed commands must not do

### 6. Cross-Platform Semantics

Examples:

- which Linux/Windows behaviors must remain identical
- which are intentionally different
- where differences must still preserve the same user contract

## Writing Rule For Each Contract

Every contract must be phrased so a reviewer can answer:

1. What exact user or system situation triggers this?
2. What exact outcome must happen?
3. Is this user-visible, internal, or both?
4. On which platforms must it hold?
5. Which tests prove it today?

If a row cannot answer those questions, it is still a principle, not yet a contract.

## Review Discipline

Future reviews should check behavior in this order:

1. Did the top-level principle change?
2. Did the executable contract change?
3. Did the mapped tests change?
4. Did both internal-state and user-visible proof get covered where required?
5. Did platform scope stay explicit?

This prevents the current failure pattern where only persistence or routing is validated while visible UX semantics remain under-specified.

## Rollout Plan

### Phase 1

Create the contract matrix file and seed it with the highest-risk current areas:

- product boundary
- continuity
- observability
- command surface

### Phase 2

Backfill explicit mappings for:

- permission boundary
- cross-platform differences

### Phase 3

Make “matrix updated when behavior meaning changes” part of the normal review checklist.

## Acceptance Criteria

- A new contract matrix document exists at a stable repo path
- The document clearly states it is development-time only, not runtime behavior
- The matrix structure separates principle, contract, visibility, and platform scope
- High-risk behavior domains are enumerated in fixed sections
- Future implementation work can be planned directly from the matrix
