# ADR-0338: Reconcile prepared managed assignment completion

- Status: `accepted`
- Decision date: 2026-09-02

## Context

A governed managed run can record `run.completed`, pass repository verification, pass the
writing-publication gate, and then lose its process before the leased assignment is finalized.
The controller already refuses to rerun a verified completed attempt, but `run.completed` alone
does not prove the writing-publication result, the exact assignment revision, or the lease under
which finalization was accepted. Treating that event as completion authority would therefore
collapse distinct evidence and could complete stale or unpublished work.

Lease expiry also cannot by itself decide this case. A completion accepted while the lease was
valid remains recoverable after expiry, while a newly claimed revision must invalidate the old
evidence. Requiring the original process to remain alive would make a crash permanently
unrecoverable.

## Decision

Add the version-1 `assignment.completion.prepared` event. The governed CLI records it only after
one managed run has emitted a valid `run.completed` result with passed verification and the
independent writing-publication gate has returned `allowed`, and immediately before ordinary
assignment finalization. Its payload binds a content-derived evidence ID, workstream,
assignment revision, agent, lease, result artifact ID and content hash, the two accepted gate
states, and preparation time. Its envelope retains the exact managed run and session.

The event is evidence, not a state transition. Failure to record it prevents successful governed
finalization. Exact duplicate evidence is idempotent; a contradictory duplicate, foreign run,
wrong assignment ancestry, result mismatch, non-passed run, invalid time, or stale coordinate
invalidates the governed projection. Historical completed runs without this event remain
`completion_reconciliation_required`; readers do not invent publication acceptance.

Extend the provider-neutral application report with verified completion evidence and add a
`reconcile_completion` action. The pure controller recommends that action only when the latest
attempt completed with passed verification, the assignment is still at the exact prepared
revision and lease, and one valid preparation event matches it. This check precedes lease-expiry
claim logic, so completed provider work is never recommended for rerun merely because its lease
expired. The content-addressed reconciliation command binds the report graph hash and every
evidence coordinate.

Local execution uses an explicit plan/apply route. Planning changes nothing. Apply reprojects the
report, requires the same command ID, then performs one workforce CAS transition. The workforce
transition accepts an expired lease only when the evidence preparation time falls within that
lease's original half-open `[acquiredAt, expiresAt)` interval. It rejects another revision,
lease, agent,
artifact, terminal state, or malformed interval. State and the new
`assignment.completion.reconciled` event commit together; event failure restores assignment
bytes. Normal uninterrupted finalization continues to emit `assignment.completed`.

No scheduler, timer, automatic apply, provider replay, approval grant, or second task store is
introduced. Events and assignment state remain canonical; reports and reconciliation commands
are rebuildable projections.

## Privacy and failure meaning

Both events retain only opaque workstream, assignment, revision, agent, lease, run, evidence,
command, artifact, status, digest, and time coordinates. They exclude task and acceptance prose,
paths, prompts, provider output, artifact bodies, reviewer identity, reasoning, credentials, and
provider configuration.

`assignment.completion.prepared` proves that the trusted governed adapter observed all required
completion gates for the exact run and lease. It does not prove assignment mutation.
`assignment.completion.reconciled` proves that the exact prepared evidence and assignment state
committed together. Missing preparation evidence, malformed or contradictory history, stale
state, and event failure record no reconciliation success. An unobserved preparation outcome
remains escalation-required rather than retryable.

## Consequences

The narrow crash gap becomes recoverable without rerunning provider work or trusting elapsed
lease time. The application, controller, workforce store, and CLI retain separate contract,
projection, state-transition, and presentation responsibilities. Future operating clients can
use the same headless plan/apply boundary.

## References

- [Governed loop and assignment graph roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0336](0336-adopt-headless-governed-loop-and-assignment-graph.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
