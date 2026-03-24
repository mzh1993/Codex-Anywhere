# Security Policy

This repository is an alpha safe execution core. Please report security problems privately.

## How To Report

Use GitHub private vulnerability reporting if it is enabled for the repository.

If private reporting is not available yet, do not open a public issue. Contact the maintainer privately through the repository owner profile and include:

- a short description of the issue
- affected files or components
- reproduction steps
- impact assessment
- whether the issue can cross the intended execution boundary

## What Counts As A Security Issue

Examples include:

- bypassing approval or denial logic
- escaping the intended isolated runtime / `CODEX_HOME`
- leaking secrets into execution paths, logs, or task state
- breaking task, approval, or recovery semantics in a way that weakens the safety boundary
- unexpected access to host-level or transport-level resources outside the intended scope

## Disclosure Expectations

- Please give maintainers a reasonable opportunity to investigate and prepare a fix before public disclosure.
- Please avoid publishing exploit details before a fix or mitigation is ready.
- If you are unsure whether something is security-relevant, report it privately first.

## Current Status

This project is not production-ready and does not claim complete operating-system-level sandboxing or high-assurance isolation. Current boundaries and gaps are described in `SECURITY_MODEL.md`.
