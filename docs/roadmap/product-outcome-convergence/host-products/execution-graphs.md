# Dynamic execution graphs

Outcome: execution graphs support bounded dynamic branches and joins.

State: `wired`.

The v2 graph contract is an additive projection over canonical assignments and events. Changes require:

- Current graph and role coordinates.
- Exact plan and approval binding.
- Acyclicity and finite node and dependency bounds.
- Deterministic blocked materialization and complete-set activation.
- Lazy v1 migration, interruption recovery, and event replay.

Arbitrary rewiring, deletion, cycles, and a second graph database remain unsupported.

[Automatic supervision topology](../../../specifications/execution/outcome-supervision/implementation/automatic-topology.md) writes graph v2 changes. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the manual reviewed topology route.

Historical evidence: the installed CLI planned and applied one reviewed four-node branch-and-join change through the removed route and replayed its topology history. See [installed bounded dynamic execution graph v2](../../../evidence/foundation/installed-bounded-dynamic-execution-graph-v2.md).
