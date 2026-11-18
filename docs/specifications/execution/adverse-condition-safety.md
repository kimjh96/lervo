# Adverse-condition safety

Status: `active`

As of: 2026-09-07

This specification defines FH4 safety evidence for Lervo's current state-changing boundaries. It adds no scheduler, loop, execution graph, task authority, or automatic retry. Canonical repository state, events, CAS artifacts, workstreams, assignments, runs, approvals, and verification retain their existing ownership.

`@lervo/execution-contract` owns pure effect and recovery meanings. Runtime packages own their effects and focused fault tests. [ADR-0560](../../decisions/foundation/0560-remove-unused-subsystems-to-harden-the-core.md) removed the inventory package and the generated adverse-condition report; the linked evidence is historical. The CLI and scripts only compose checks and render results.

- [Recovery, effects, and cancellation](adverse-condition-safety/recovery.md)
- [Telemetry privacy and threat boundaries](adverse-condition-safety/security.md)
- [Capacity, concurrency, and retention](adverse-condition-safety/capacity.md)
- [Compatibility and verification](adverse-condition-safety/verification.md)

See [foundation adverse-condition evidence](../../evidence/foundation/adverse-condition-v1.md).
