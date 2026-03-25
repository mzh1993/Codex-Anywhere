# Top-Level Doc Boundary Cleanup Design

- Date: 2026-03-25
- Stage: approved design

## Goal

Remove protocol-level ambiguity from top-level product documents by separating:

- north-star and product principles
- internal decision baselines
- roadmap and build priorities
- V1 protocol / command / state-machine details

The result should make the repository easier to read and harder to misinterpret.

## First Principle

Top-level documents should describe product direction and judgment, not carry detailed runner protocol.

If a document is meant to answer “what are we building and why,” it should not also answer “which fallback command is valid in `awaiting_input`.”

## Problem Statement

The current repository still mixes two layers:

- top-level product positioning and design principles
- low-level V1 interaction protocol and fallback command details

That mixing creates three problems:

1. Readers encounter obsolete or overly concrete V1 protocol details too early.
2. Top-level product documents drift toward implementation snapshots instead of decision standards.
3. The repository repeatedly re-explains the same protocol in multiple places, increasing the chance of contradiction.

## Approved Document Boundary

### 1. `README.md`

`README.md` should remain a lightweight project entry page.

It should keep only:

- what this repository is
- minimum infrastructure requirements
- how to bootstrap it
- the high-level project role
- where to read next

It should not carry:

- detailed `/codex ...` command tables
- state protocol matrices
- approval protocol examples
- recovery protocol details
- dense V1 interaction rules

At most, it may keep one short statement that bridge commands are fallback-only and natural language is the main path.

### 2. `docs/product-north-star.md`

This document should answer:

- what the product fundamentally is
- what first principles govern it
- what capability layers matter most
- what product feeling the user should eventually get

It should not carry:

- V1-specific command protocol
- transport-specific interaction minutiae
- temporary workaround rules

It should be the highest-level product compass.

### 3. `docs/product-decision-baseline.md`

This document should act as the internal decision court.

It should keep:

- what counts as drift
- what bridge is allowed to own
- what must stay with Codex
- what user burden patterns are unacceptable
- what questions future proposals must survive

It should stay principle-heavy and stable.

It should not become a protocol reference.

### 4. `docs/roadmap.md`

This document should translate the north star into capability priorities.

It should keep:

- what capability gaps matter first
- what sequencing follows from first principles
- what not to prioritize yet

It should not embed protocol details.

It may reference major architectural work such as bridge-owned control-plane capability, but only at capability level.

### 5. `docs/feishu-codex-runner-v1.md`

This becomes the single source of truth for current V1 protocol.

It should contain:

- current task / run protocol
- current fallback commands
- current approval behavior
- current recovery behavior
- current state directories and persistence details
- current transport-specific constraints

It should contain only currently valid protocol, not old competing variants and not speculative future protocol.

## Approved Cleanup Rule

Top-level docs must stop carrying protocol fragments once that protocol has a canonical home in `docs/feishu-codex-runner-v1.md`.

In short:

- top-level docs explain principles
- V1 runner doc explains current protocol

## Required Revisions

### `README.md`

- remove the detailed Feishu command block
- remove most V1 interaction bullets
- keep only one short fallback-command statement if still necessary
- keep the project lightweight and tool-like

### `docs/product-north-star.md`

- add the newly agreed `codex task` / `bridge action` boundary
- reflect that repository-owned host control-plane actions belong to bridge
- keep this at principle level, not protocol level

### `docs/product-decision-baseline.md`

- align with the newest rulings:
  - bridge-owned repository control plane
  - continuity separation
  - bridge invisibility by default
- keep it as the internal product court

### `docs/roadmap.md`

- add bridge-owned control-plane capability at roadmap level
- keep the wording at capability / sequencing level
- do not pull protocol details upward

### `docs/feishu-codex-runner-v1.md`

- delete older protocol assumptions that we have now rejected
- keep only the currently valid V1 rules
- remove hedge wording that leaves old and new interaction models side by side

## Non-Goals

This cleanup does not attempt to:

- redesign the runtime protocol itself
- rename all product concepts across the repo
- rewrite external marketing copy
- expand beyond documentation structure and wording alignment

## Acceptance Criteria

The cleanup is successful when:

- a new reader can understand the product at top level without reading protocol noise
- internal decision documents no longer compete with protocol documents
- obsolete protocol fragments are removed instead of restated
- `docs/feishu-codex-runner-v1.md` is the only detailed V1 protocol reference
- the repository’s top-level reading path matches the latest product decisions
