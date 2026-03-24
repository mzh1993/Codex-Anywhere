# Roadmap

> Public roadmap for external collaborators and internal development. Status language is directional, not a release promise.

## Now

- Tighten public release posture for the first GitHub alpha release
- Remove host-specific path leakage from public-facing docs
- Keep the product framed as a safe execution core, not a generic chat bridge
- Stabilize task/run/approval/recovery semantics
- Keep Feishu as the first control plane and OpenClaw as the current transport shell

## Next

- Strengthen execution boundaries so safety is enforced by actual runtime capability limits, not just prompt/path policy
- Introduce stronger runtime ownership and recovery semantics for crash/restart cases
- Expand auditability around runs, approvals, denials, and recovery events
- Add more integration-style verification around restart, approval, and failure flows
- Reduce remaining host-coupled assumptions in configuration and operator workflows

## Later

- Add more transport adapters without changing core execution semantics
- Improve the control plane with richer status presentation, approval UX, and intermediate-result delivery
- Add operator tooling for inspection, cleanup, history browsing, and recovery handling
- Consider stronger sandboxing and capability controls as first-class runner features

## Non-Goals For The Current Phase

- Becoming a generic multi-IM platform before the core is stable
- Optimizing for rich channel UI before execution semantics are hardened
- Claiming production-grade security before runtime boundaries are stronger
- Letting any transport layer define task meaning or approval meaning
