# ADR-0407: Settle invocation-fenced abandoned managed turns

- Status: accepted
- Decision date: 2026-09-15

## Context

[ADR-0402](0402-settle-boot-fenced-pre-turn-managed-interruptions.md) settles managed requests interrupted before their provider turn, fenced by a completed host reboot. It cannot resolve a started provider session.

Restarting a scoped Node during dispatch produces that excluded case: the run reaches `adapter.started`, records a provider process observation and injects context, then loses its parent without a terminal event or usage receipt. Resource projection permanently blocks the goal: a run without `run.completed` or `run.failed` remains active, and a started adapter without provider-reported usage prevents complete usage accounting. Later decisions fail with `concurrency_exceeded`, `usage_unobserved` and `resource_unobserved`.

This stranded the standing lineage's first successor goal on 2026-09-15 until cancellation. Restarts cannot clear it because absence-based supersession correctly refuses a started run.

## Decision

Add a manually invoked, Node-hosted `recover-abandoned-turn` command requiring the original admitted managed plan, a current eligible mandate and the exclusive owner lease, as pre-turn recovery does.

### Invocation fence

Use a unit invocation transition rather than a reboot. The host adapter reads the unit's ordered invocation inventory from the local journal and its current invocation identifier from the service manager. Require:

- One invocation uniquely bracketing the run's events.
- A completed successor invocation.
- A distinct current invocation.

Unit invocations are sequential. Each owns the quiet interval after its last log line until the next invocation starts, so a run during log silence still belongs to exactly one window. Accept a window ending exactly at its successor's start; reject one extending beyond that start.

### Proof and terminal write

Admit only a session demonstrably performing no work:

- Exactly one `adapter.started`, in `read_only` execution mode.
- At least one provider process observation, none proving work progress.
- No usage, stop, terminal or effect event.

The CAS diagnostic is `work.managed_abandoned_turn_failure` version 1, containing:

- One `{code: interrupted_after_turn_start, phase: recovery, retryable: false}` failure.
- Every original run event pinned by identifier, hash and type.
- A `host.unit_invocation_witness` version 1.

Before appending `run.failed`, the owner-fenced writer rechecks witness freshness, the current invocation, the event head and unchanged run history. The payload contains exactly `failureCode: interrupted_after_turn_start`, `retryable: false` and `diagnosticDigest`.

### Accounting and privacy

Readers settle a proven abandoned run so it releases its concurrency slot and stops nulling observed usage. Its reservation remains charged as spent-unknown. The run leaves the usage observation population, which can never receive its receipt, but remains in the reservation population so accounting understates nothing.

Events and CAS carry only identifiers, hashes, invocation identifiers and times; no task prose, credentials or source bytes.

## Consequences

A goal stranded by a restart during dispatch can continue after one explicit repair. The interrupted assignment may reopen through ordinary reviewed rework under its attempt ceiling. Recovery does not establish that repeating the turn is safe: the terminal is not retryable, and the failure observation requires inspection rather than classifying a known safe failure.

Recovery refuses writable adapters, proven work progress, effect events, usage receipts and runs whose incident invocation is not uniquely observable in the journal. These cases still require human inspection.

A stranded run outlives its goal, so repair does not require a current goal. Settlement authority is narrower than execution authority: require an unrevoked, unexpired installation for the exact supervision and owner, read twice to prove it unchanged, with no requirement concerning the current workstream.

Containment comes from these constraints:

- The writer refuses a run whose admitted plan names a different workstream than the binding.
- The exclusive owner lease serialises repair.
- The terminal grants no execution, reopens no assignment and publishes nothing.

Thus, even a settled or superseded goal can have its unterminated run accounted for, preserving complete event history and reservation accounting.

## References

- [ADR-0402](0402-settle-boot-fenced-pre-turn-managed-interruptions.md)
- [Assignment recovery](../../../../specifications/execution/outcome-supervision/implementation/managed-execution/assignment-recovery.md)
