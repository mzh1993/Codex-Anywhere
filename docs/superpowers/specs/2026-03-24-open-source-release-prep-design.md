# Open-Source Release Prep Design

- Date: 2026-03-24
- Stage: approved design

## Goal

Prepare this repository for a first public GitHub release as an alpha safe-execution-core project.

The aim is not to claim production readiness. The aim is to make the public artifact honest, readable, collaborator-friendly, and free of local-host assumptions that would confuse external users.

## Product Positioning

This repository should be presented as:

- an alpha safe execution core for Codex-driven remote work
- Feishu-first today
- OpenClaw-based as the current transport shell
- not yet production-ready

The repository should not present itself as:

- a generic IM bridge
- a mature production runner
- a pure OpenClaw plugin product

## Release-Prep Objectives

Before opening the repository publicly, the repository should satisfy six release-prep objectives.

### 1. Remove local-host leakage from public-facing docs

Current docs still contain many machine-specific absolute paths such as `/mnt/...` and `/home/neousys/...`.

These are acceptable during local development, but they are poor public documentation because they:

- make the project look host-bound rather than reusable
- leak irrelevant workstation details
- raise unnecessary security and polish concerns for external readers

Public-facing docs should switch to:

- repo-relative paths
- variable-based examples such as `$REPO_ROOT`
- generic host examples such as `$HOME/.codex/auth.json`

Scope for this cleanup should prioritize:

- `README.md`
- `docs/feishu-codex-runner-v1.md`
- any operator-facing public runbook that is likely to be read directly from GitHub

Research or local-notes documents can remain more literal if they are explicitly framed as local research artifacts.

### 2. Add explicit public release posture

The README should clearly state:

- alpha status
- not production-ready
- current stable core: text, status, approval
- current architecture: core protocol here, Feishu control plane first, OpenClaw transport shell today

This keeps outside expectations aligned with reality and prevents accidental overclaiming.

### 3. Add a public security model / boundary document

A public repository for a "safe runner" needs an explicit statement of:

- what the current product boundary is
- what guarantees are intended
- what guarantees do not yet exist
- what is currently blocked, approval-gated, or out of scope

This document does not need to be a formal threat-model paper yet.

It does need to be explicit enough that collaborators understand:

- current safety assumptions
- current known gaps
- why transport semantics must not define execution semantics

A concise `SECURITY_MODEL.md` at repo root is the best fit for first release.

### 4. Add a public roadmap for external and internal use

The roadmap should work for two audiences at once:

- external readers deciding whether the project direction is serious
- internal development deciding sequencing and priority

The roadmap should be organized by horizon, not by vague wishlist.

Recommended sections:

- `Now` — current hardening and open-source release prep
- `Next` — execution-boundary hardening, runtime ownership, auditability
- `Later` — transport adapters, richer control plane, operator tooling

Each roadmap item should be concrete and product-meaningful.

### 5. Add an explicit non-goals / current limits section

The public docs should state what this repository is not trying to do yet.

Examples:

- not a production multi-tenant remote execution platform
- not a generalized channel abstraction framework yet
- not a replacement for desktop Codex session UX
- not a complete system-boundary enforcement solution yet

This prevents external readers from projecting the wrong product category onto the repo.

### 6. Check for public-surface secret/config confusion

The release-prep pass should verify that public docs and examples:

- do not embed real secrets
- do not imply checked-in runtime credentials
- do not normalize copying host-private paths as if they were repository requirements

This is mostly a documentation and framing cleanup, not a runtime code-path rewrite.

## Design Constraints

- Do not add runtime dependencies.
- Do not change bridge runtime semantics as part of this release-prep pass.
- Keep changes focused on public-facing documentation, positioning, and operator clarity.
- Preserve already-correct product framing: safe execution core first, transport shell second.

## Deliverables

This release-prep pass should produce:

- updated `README.md`
- updated `docs/feishu-codex-runner-v1.md`
- new `ROADMAP.md`
- new `SECURITY_MODEL.md`
- optional light wording cleanup in related public docs when directly necessary

## Recommended Order

1. Update README positioning and path examples
2. Add `SECURITY_MODEL.md`
3. Add `ROADMAP.md`
4. Update `docs/feishu-codex-runner-v1.md`
5. Re-run verification and do a final pass for path leakage in public docs

## Success Criteria

The release-prep work is successful if:

- a new GitHub visitor can understand what the project is in under two minutes
- the repo no longer looks tied to one local machine
- the README does not overclaim production readiness
- the roadmap gives a believable next-step story
- the security/boundary document makes current guarantees and gaps explicit

## Summary

The main task is not adding new capability. The main task is making the current capability publishable without ambiguity.

That means tightening public framing, removing host-specific leakage, and giving collaborators an honest map of current boundaries and future direction.
