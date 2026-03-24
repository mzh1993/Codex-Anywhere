# Superpowers Workflow for `codex_feishu`

`superpowers` is useful here as a thinking and review layer, not as part of the runtime stack.

## What to use

- `brainstorming` for requirements, scope, and tradeoffs
- `writing-plans` for decision-complete implementation plans
- `requesting-code-review` before shipping meaningful changes
- `verification-before-completion` for bug fixes and security-sensitive work

## What not to use by default

- `subagent-driven-development`
- `dispatching-parallel-agents`
- `using-git-worktrees`
- `executing-plans` on bridge/runtime/security changes without explicit human sign-off

These workflows optimize for speed and parallelism. This repo needs boundary control more than throughput.

## Repo-specific guardrails

- Keep `superpowers` out of the runtime dependency graph.
- Do not change the transport/executor split without an explicit design pass.
- Preserve the current boundary:
  - Feishu is the remote entry
  - OpenClaw is transport, pairing, and shell
  - `codex exec` is the only executor
- Treat these areas as security-sensitive:
  - `extensions/codex-bridge/index.js`
  - `scripts/bootstrap-codex-feishu.sh`
  - `scripts/openclaw-isolated.sh`
  - `scripts/feishu-app-audit.sh`

## Recommended development loop

1. Use `brainstorming` to refine the change request.
2. Convert the accepted design into a compact `writing-plans` plan.
3. Implement manually or with tightly supervised agent execution.
4. Run targeted checks.
5. Use `requesting-code-review` before finalizing.

## Good first uses in this repo

- Rewrite the risk model into a decision table for allow / approve / reject
- Design log redaction for inbound text and bridge logs
- Minimize child-process environment inheritance for spawned `codex` runs
- Tighten audit retention for approvals and task outcomes

## Suggested prompts

### Clarify a risky change

```text
Use brainstorming to refine a safe design for changing the approval model in codex_feishu.
Do not suggest runtime dependencies. Preserve the OpenClaw transport / codex exec executor split.
```

### Produce an implementation plan

```text
Use writing-plans to create a detailed implementation plan for adding log redaction to codex_feishu.
Keep the current Feishu/OpenClaw/Codex architecture unchanged.
```

### Review before shipping

```text
Use requesting-code-review on this codex_feishu change.
Focus on isolation boundaries, approval flow, secret exposure, and auditability.
```

## Installation note

If you choose to install `superpowers`, follow the official Codex instructions:

- `https://github.com/obra/superpowers`
- `https://github.com/obra/superpowers/blob/main/docs/README.codex.md`

Do that in your user environment, not inside this repository.
