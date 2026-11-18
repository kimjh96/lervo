# Bounded work graph

State: `wired`

Outcome: bounded work forms a graph; verification, retry, resource, approval, and completion policy govern each attempt.

Evidence: assignment DAG projection, attempt and resource projections, supervised managed attempts, verification, leases, and prepared completion events exist. [ADR-0560](../../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed pure next-action decisions, the manual `loop run` route, the governed reconciliation command, and governed token-dimension and duration budgets.

Preserve the fail-closed observation boundary.
