# Contributing

Thanks for taking the time to work on this repository.

## Before You Start

Please read these first:

- `README.md`
- `SECURITY_MODEL.md`
- `ROADMAP.md`
- `docs/feishu-codex-runner-v1.md`

This project is not a generic chat bot framework. The core product is a safe execution core. Feishu is the first control plane. OpenClaw is the current transport shell.

## Contribution Priorities

The highest-value contributions usually improve one of these areas:

- execution boundary clarity and enforcement
- task, run, approval, and recovery semantics
- auditability and operator workflow
- documentation that reduces ambiguity for external users
- transport integration work that does not redefine core semantics

## Preferred Contribution Flow

For non-trivial changes:

1. Open an issue or discussion first.
2. State the problem in product terms, not only in channel terms.
3. Explain whether the change affects execution semantics, approval semantics, or recovery semantics.
4. Explain whether the change belongs to the execution core or only to a control-plane / transport surface.
5. Keep the first patch focused and easy to review.

## Pull Request Expectations

A good pull request here should make it easy to answer:

- What problem does this change solve?
- Does it affect task meaning, approval meaning, or recovery behavior?
- Is the change in the execution core, the transport shell, or public documentation?
- What verification did you run?

Please keep unrelated cleanup out of the same pull request.

## What To Avoid

Please do not send drive-by changes that:

- treat Feishu or any other channel as the source of execution semantics
- add `superpowers` to runtime code paths
- weaken the isolated runtime / isolated `CODEX_HOME` boundary
- broaden scope into a generic multi-IM platform before core behavior is clearer
- mix large refactors with protocol or security-sensitive changes

## Security Issues

If you believe you found a security issue, do not open a public issue first. Follow `SECURITY.md`.

## Development Notes

- Keep wording direct and precise.
- Avoid hype and avoid AI-marketing language.
- Prefer small, reviewable patches with explicit verification steps.
