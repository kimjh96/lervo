# ADR-0407: Settle invocation-fenced abandoned managed turns

- Status: accepted
- Decision date: 2026-09-15

## Context

[ADR-0402](0402-settle-boot-fenced-pre-turn-managed-interruptions.md) settles a managed request interrupted before its provider turn, fenced by a completed host reboot, and states that it cannot resolve a provider session that started. A scoped Node restarted while a dispatch is in flight produces exactly that excluded case: the run reaches `adapter.started`, records a provider process observation and injects context, then loses its parent with no terminal event and no usage receipt. The resource projection then blocks the goal permanently, because a run without `run.completed` or `run.failed` is forced into the active set, and a started adapter without a provider-reported usage record makes complete usage impossible, so every later decision is refused with `concurrency_exceeded`, `usage_unobserved` and `resource_unobserved`. This stranded the first successor goal of the standing lineage on 2026-09-15 until the goal was cancelled; restarts do not clear it, because absence-based supersession correctly refuses a run that started.

## Decision

Add a manually invoked, Node-hosted `recover-abandoned-turn` command. It requires the original admitted managed plan, a current eligible mandate and the exclusive owner lease, exactly as the pre-turn recovery does. The fence is a unit invocation transition rather than a reboot: the host adapter reads this unit's ordered invocation inventory from the local journal and its current invocation identifier from the service manager, and requires one invocation uniquely bracketing the run's events, a completed successor invocation, and a distinct current invocation. Because a unit's invocations are sequential, each invocation owns the quiet interval after its last log line until the next invocation starts, so a run that happened while the unit logged nothing still falls inside exactly one window. A window that ends exactly where its successor begins is therefore the ordinary case and is accepted; one that extends past its successor's start is rejected.

The proof admits only a session that demonstrably performed no work: exactly one `adapter.started` in `read_only` execution mode, at least one provider process observation with none proving work progress, and no usage, stop, terminal or effect event. The CAS diagnostic is `work.managed_abandoned_turn_failure` version 1 with one `{code: interrupted_after_turn_start, phase: recovery, retryable: false}` failure, every original run event pinned by identifier, hash and type, and a `host.unit_invocation_witness` version 1. The owner-fenced writer rechecks witness freshness, the current invocation, the event head and the unchanged run history before appending `run.failed` with payload exactly `failureCode: interrupted_after_turn_start`, `retryable: false` and `diagnosticDigest`.

Readers settle a proven abandoned run so it stops holding the concurrency slot and stops nulling observed usage, and keep its reservation charged as spent-unknown. The run leaves the usage observation population, which can never gain its receipt, but never leaves the reservation population, so accounting understates nothing. Events and CAS carry identifiers, hashes, invocation identifiers and times only; no task prose, credentials or source bytes.

## Consequences

A goal stranded by a restart during dispatch can continue after one explicit repair, and the interrupted assignment may be reopened through the ordinary reviewed rework path under its attempt ceiling. The recovery never claims the turn is safe to repeat: the terminal is not retryable, and the failure observation classifies it as requiring inspection rather than a known safe failure. It refuses a writable adapter, any proven work progress, any effect event, any usage receipt, and any run whose incident invocation is not uniquely observable in the journal, all of which still require human inspection.

A stranded run outlives its goal, so the repair does not require the goal to still be current. Settlement authority is deliberately narrower than execution authority: an unrevoked, unexpired installation for the exact supervision and owner, read twice to prove it did not change, and nothing about the current workstream. Containment comes from elsewhere. The writer refuses a run whose admitted plan names a different workstream than the binding, the exclusive owner lease serialises the repair, and the terminal grants no execution, reopens no assignment and publishes nothing. A goal that has already settled or been superseded therefore still gets its unterminated run accounted, which keeps the event history and the reservation ledger complete.

## References

- [ADR-0402](0402-settle-boot-fenced-pre-turn-managed-interruptions.md)
- [Assignment recovery](../../../../specifications/execution/outcome-supervision/implementation/managed-execution/assignment-recovery.md)
