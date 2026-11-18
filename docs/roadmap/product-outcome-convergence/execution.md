# Prime-Agent-derived execution outcomes

Part of [Product outcome convergence](../product-outcome-convergence.md). Its baseline, acceptance states, and claim boundaries apply to all linked outcomes.

- [Bounded work graph](execution/bounded-work-graph.md): `wired`.
- [Root and recursive worker contracts](execution/worker-contracts.md): `wired`.
- [Portable attach, detach, and resume](execution/portable-continuation.md): `wired`.
- [Provider-native session resume](execution/provider-native-resume.md): `external dependency`.
- [Durable repository goal lifecycle](execution/goal-lifecycle.md): `wired`.
- [Runtime liveness through heartbeats](execution/runtime-liveness.md): `wired`.
- [Direct agent communication](execution/agent-communication.md): `wired`.
- [Runtime portable-skill candidates](execution/portable-skill-candidates.md): `wired`.
- [Explicit durable-instruction intake](execution/durable-instruction-intake.md): `wired`.
- [Agent-profile candidates](execution/agent-profile-candidates.md): `wired`.

[ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the bounded autonomous continuation outcome with `lervo loop schedule` and its evidence. Outcome supervision continues accepted work on the Node.
