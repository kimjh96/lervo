# Dynamic execution graphs

Outcome: execution graphs support bounded dynamic branches, joins, and reviewed topology changes.

State: `wired`.

The v2 graph contract is an additive projection over canonical assignments and events. Changes require:

- Current graph and role coordinates.
- Exact plan/approval/reviewer authority.
- Acyclicity and finite node and dependency bounds.
- Deterministic blocked materialization and complete-set activation.
- Lazy v1 migration, interruption recovery, and event replay.

Arbitrary rewiring, deletion, cycles, and a second graph database remain unsupported.

Evidence: the installed CLI plans and applies one reviewed four-node branch-and-join change and replays its topology history. The bounded scheduler executes all nodes in dependency order. Source acceptance also interrupts materialization after one blocked node and proves exact same-reviewer recovery. See [installed bounded dynamic execution graph v2](../../../evidence/foundation/installed-bounded-dynamic-execution-graph-v2.md).
