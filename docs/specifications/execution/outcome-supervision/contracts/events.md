# Persistence and versioned events

Workstreams remain goal authority; assignments remain task authority. Exact responsibility and decision artifacts use CAS and existing ownership and access rules. The local event store holds causal records; rebuildable projections cannot authorize effects.

Reuse the existing policy and approval artifact lifecycle only if it represents every mandate constraint; otherwise, version it before activation. Revocation and ancestry are mandatory. A JSON file gains no authority from existing on disk.

## Contracts

- [Event contract](events/event-contract.md): envelopes, payloads, evidence, and failure boundaries.
- [Reader compatibility](events/reader-compatibility.md): reader-first deployment and interruption reconciliation.
- [Idempotency and recovery](events/idempotency-and-recovery.md): invocation reservations, effect receipts, recovery, escalation, replacement, and preflight resolution.

## References

- [ADR-0430](../../../../decisions/execution/orchestration/governed-work/owner-recovery/0430-reconcile-terminal-read-only-owner-interruptions.md)
- [Research inputs and independent acceptance](../implementation/research-execution.md)
- [Canonical owner artifact review](../implementation/managed-execution/artifact-review.md)
- [Scoped owner handoffs](../implementation/scoped-handoffs.md)
