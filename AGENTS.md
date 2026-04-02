# Repository Agent Notes

This repo may use `superpowers`, but only as a development workflow aid.

## Preferred workflow

- For non-trivial changes, use `brainstorming` before editing.
- After the design is accepted, use `writing-plans`.
- Before handing off, use `requesting-code-review` or `verification-before-completion`.

## Do not use by default

- `subagent-driven-development`
- `dispatching-parallel-agents`
- `using-git-worktrees`
- `executing-plans` for production code changes

These add too much automation for a repo with remote execution, approval, and isolation boundaries.

## Hard boundaries

- Do not add `superpowers` as a runtime dependency of `codex_feishu`.
- Do not wire `superpowers` into Feishu, OpenClaw, or the bridge execution path.
- Treat the bridge security boundary as intentional: isolated runtime, isolated `CODEX_HOME`, paired DM-only claim, approval gating, and auditability.

## Repo-local ops hooks

- When a historical bridge continuity lane must be revived, prefer `node tools/revive-task-lane.mjs --sender-id <sender> --task-id <task>` over hand-editing persisted state JSON.
- Use `--dry-run` first when you only need to inspect the proposed repair.
- This tool is repo-local operations support only; do not expose it through bridge runtime or `/codex`.

## High-signal references

- `README.md`
- `docs/feishu-codex-bridge-v1.md`
- `extensions/codex-bridge/index.js`
- `scripts/feishu-app-audit.sh`
