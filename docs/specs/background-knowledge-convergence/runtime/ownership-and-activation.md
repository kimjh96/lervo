# Ownership and activation

The runtime contract covers:

- [Runtime ownership](ownership-and-activation/runtime-ownership.md): package responsibilities, child processes, repository leases, and recovery behavior.
- [Delegation and activation](ownership-and-activation/delegation-and-activation.md): activation prerequisites and host-local authority.
- [Asset manifest authority](ownership-and-activation/asset-manifest-authority.md): bounded asset declarations and reviewed delegation application.
- [Cross-host ownership](ownership-and-activation/cross-host-ownership.md): one Hub-leased convergence owner across hosts, the commit fence, and replica coordination.
- [Knowledge supersession](ownership-and-activation/knowledge-supersession.md): how superseded knowledge commits leave every replicated checkout.
- [Fleet continuity](ownership-and-activation/continuity.md): host policy, same-scope renewal, seeding across hosts, zero-touch owner-host configuration, and the doctor.

Governing decisions:

- [ADR-0441: Resident knowledge isolation](../../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md).
- [ADR-0442: Conversation repository snapshot isolation](../../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md).
- [ADR-0444: Materialization serialization with managed runs](../../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md).
- [ADR-0438: Delegation-bound asset manifests](../../../decisions/knowledge/repository/canonicalization/0438-bind-bounded-asset-manifests-to-delegation.md).
- [ADR-0466: Cross-host convergence owner lease](../../../decisions/coordination/sync/0466-coordinate-cross-host-knowledge-convergence-with-a-hub-owner-lease.md).
- [ADR-0468: Supersession across replicated checkouts](../../../decisions/coordination/sync/0468-propagate-knowledge-supersession-across-replicated-checkouts.md).
- [ADR-0469: Background knowledge continuity on every host](../../../decisions/coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md).
