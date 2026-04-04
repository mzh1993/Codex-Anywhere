# Finish Card Duplication Design

## Summary

This design fixes the duplicated finish-card content bug in the Feishu bridge result card. The root cause is that the bridge currently stores the whole final Codex reply in `task.summary`, then renders `changedFiles` and `nextSteps` a second time from structured extraction.

## Root Cause

1. `finishTask()` reads `last-message.txt` and persists the whole final reply as `task.summary`.
2. The finish-card renderer appends `task.summary`, then separately appends `changedFiles` and `nextSteps`.
3. If the final reply already contains `Summary / Changed Files / Next Steps`, the finish card repeats those sections.
4. `extractChangedFiles()` can also over-match suffix paths like `/specs/...` from a larger full path on the same line.

## Decisions

1. Persist only the summary section into `task.summary`, not the whole final reply.
2. Keep `changedFiles` and `nextSteps` as explicit structured extraction.
3. Tighten changed-file extraction so one file line does not produce duplicate suffix paths.
4. Add regression coverage using a real-world duplicated finish-card sample.
5. Update the contract matrix because this is a user-visible observability behavior change.

## Non-Goals

- No reply-plane implementation yet.
- No change to task continuity or progress-card update semantics.
- No change to bridge-action finish rendering.

## Expected Outcome

The finish card should show one concise summary block, one changed-files block, and one next-steps block, without duplicated sections or truncated duplicate path variants.
