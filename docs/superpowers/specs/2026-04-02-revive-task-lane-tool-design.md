# Revive Task Lane Tool Design

> Scope: add a repo-local operations tool that can safely revive a previously interrupted bridge task lane without hand-editing persisted state JSON.

## Problem

When an older task lane has already been persisted into a terminal state before continuity fixes were deployed, recovering that lane currently requires manual edits to:

- `profiles/<sender>.json`
- `tasks/<task>.json`

This is operationally useful but error-prone. We want a deterministic internal tool for continuity recovery without exposing new bridge product surface.

## Product Boundary

This is not a bridge runtime feature.

- It must not be exposed through `/codex`
- It must not be wired into Feishu, OpenClaw, or the bridge execution path
- It exists only as a repo-local operations tool for maintainers

The user-facing product remains unchanged. This tool is purely for internal repair when stored continuity state needs to be corrected.

## Decision

Add a repo-local CLI tool at:

- `tools/revive-task-lane.mjs`

Add a small repo-local agent hook in:

- `AGENTS.md`

The hook tells repo-scoped agentic work to prefer this tool over hand-editing continuity state files directly.

## Tool Behavior

Inputs:

- `--sender-id <sender>`
- `--task-id <task>`
- `--dry-run`

Optional internal defaulting:

- default bridge state root resolves to `$REPO_ROOT/.isolated/codex-feishu/state/codex-bridge`

Behavior:

1. Read the sender profile and target task
2. Validate identity and continuity consistency
3. Refuse unsafe or unrelated revives
4. Create timestamped backups of touched JSON files
5. Rewrite the task into a resumable interruption state
6. Point the sender profile back to that task
7. Print a concise recovery summary

## Safety Checks

The tool must fail closed when:

- the profile file does not exist
- the task file does not exist
- `profile.senderId !== task.senderId`
- the provided `--sender-id` does not match both records
- the task belongs to a different conversation than the current profile
- the task is not a revivable continuity candidate

Initial revivable candidate scope stays narrow:

- existing task status is `aborted`
- and the stored task error is `gateway stop`

No broad `--force` mode in this first version.

## Persisted Repair Shape

The revived task should be rewritten to:

- `status: "awaiting_input"`
- `finishedAt: null`
- `lastStatusHint: "run.interrupted"`
- `requiresExplicitContinue: true`
- `error: null`
- `updatedAt: <now>`

The revived profile should be rewritten to:

- `activeTaskId = taskId`
- `lastTaskId = taskId`
- `lastSessionId = task.sessionId` when present
- `updatedAt = <now>`

## Non-Goals

- No user-facing revive command
- No automatic selection of “best task to revive”
- No multi-task bulk repair
- No support for arbitrary terminal task resurrection
- No runtime dependency on superpowers

## Acceptance Criteria

- Dry-run reports intended changes without mutating files
- Live run creates backups before mutating files
- Live run rewrites task/profile into a resumable continuity state
- Invalid sender/task combinations fail closed
- `AGENTS.md` tells repo-local agents to prefer the tool over manual state edits

## Files

- Create: `tools/revive-task-lane.mjs`
- Create: `tools/lib/revive-task-lane-core.mjs`
- Create: `tools/test/revive-task-lane.test.mjs`
- Modify: `AGENTS.md`
