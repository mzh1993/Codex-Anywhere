# Feishu Closed-Loop Top-Level Alignment Design

## Summary

This design upgrades the product direction from "remote Codex entry" to "remote Codex closed-loop interaction in Feishu" without thickening the bridge. The bridge remains a thin connection layer; Codex remains the only primary intelligence surface.

## Problem

Current top-level wording still over-emphasizes Feishu as an input channel and does not clearly state that results and user-consumable outputs should naturally close the loop back into the originating Feishu conversation. That gap makes later feedback-loop work easier to mis-scope into a second bridge product.

## Decisions

1. Replace the north-star sentence with: `Feishu 应成为 Codex 的低心智远程闭环交互面。`
2. Keep `Codex` as the only primary interaction object and keep the bridge as the thin closed-loop connection layer.
3. Add explicit low-cognitive-load principles: less learning, less specifying, less interruption.
4. Add explicit closed-loop direction: user-consumable status/results/outputs should naturally return to the originating Feishu conversation.
5. Record in the decision baseline that:
   - Feishu is the primary interaction surface.
   - default return flow belongs to the current Feishu context.
   - bridge may return task status/results/attachments, but may not become a Feishu business assistant.
6. Update the roadmap so the next phase is feedback-loop closure first, then richer Feishu object collaboration.
7. Update the contract matrix because this changes top-level product-boundary meaning.

## Non-Goals

- No V1 runtime protocol change in this edit.
- No new bridge runtime commands.
- No implementation of reply plane or object-action plane in this edit.
- No expansion of bridge ordinary-text ownership.

## Expected Outcome

After this change, the top-level docs will consistently describe Feishu as the low-cognitive-load closed-loop interface for Codex, while preserving the thin-bridge rule and leaving runtime behavior unchanged.
