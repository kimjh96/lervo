# ADR-0406: Supersede never-bound claims and floor owner completion windows

- Status: accepted
- Decision date: 2026-09-15

## Context

The first successor goal of the standing lineage stalled at 01:30 UTC on 2026-09-15. The owner requested rework and proposed the successor responsibility with a 154-second completion window; the automatic recovery claim computed a 150-second lease with the five-second admission margin, and by the time the fenced acquisition re-checked the deadline five seconds later the lease no longer fit. The claim failed before writing anything, its effect was recorded uncertain, and every later cycle either failed on the same stale claim or, once the plan deadline had passed, reported `pending_decision_requires_reconciliation`, because responsibility claims had no supersession path. The goal could not continue and, since it was not settled, the standing lineage could not start the next one.

## Decision

- A never-bound responsibility claim is superseded like an unstarted owner reasoning or workspace preparation: when its source changed or its plan deadline passed, the Node records a version-7 `work.effect_absence` inspection and the existing `work.supervision.decision.superseded` event under the owner fence, after proving under the same fence that the binding event is absent and the assignment record is unchanged. The decision journal validates that inspection before treating the decision as superseded.
- Claims reserve a thirty-second admission margin before the completion deadline instead of five seconds.
- The native owner's completion window is floored at ten minutes, or the mandate's maximum deadline when shorter; a shorter proposal is raised, not rejected, and the owner instructions state the floor.
- A recovery claim whose successor responsibility can no longer hold the margin plus a minimal lease is not materialized; the owner decides again with attention rather than a failing cycle.

## Consequences

An interrupted claim no longer pins a goal in reconciliation. A rework attempt gets at least the window a worker turn needs, so the race between proposal and acquisition disappears in practice. A successor responsibility whose window has already elapsed still needs a new owner decision; recording that state as a bounded assignment failure remains a follow-up.

## Verification

- `supervision-claim-supersession` runtime test: a claim that fails before binding stays uncertain, is superseded after its deadline with one inspection-backed event, and a fresh claim over the same assignment is admitted afterwards.
- Existing claim, topology, reasoning supersession, native owner, workforce, and work-controller suites pass unchanged.

## References

- [Responsibility claim supersession](../../../../specifications/execution/outcome-supervision/implementation/recovery/decisions-and-replay/claim-supersession.md)
- [ADR-0405](0405-standing-supervision-lineage.md)
