# ADR-0406: Supersede never-bound claims and floor owner completion windows

- Status: accepted
- Decision date: 2026-09-15

## Context

The standing lineage's first successor goal stalled at 01:30 UTC on 2026-09-15. The owner requested rework and proposed a successor responsibility with a 154-second completion window. Automatic recovery computed a 150-second claim lease with a five-second admission margin; when fenced acquisition rechecked the deadline five seconds later, the lease no longer fit.

The claim failed before writing anything, and its effect was recorded uncertain. Subsequent cycles failed on the stale claim or, after the plan deadline, reported `pending_decision_requires_reconciliation`: responsibility claims had no supersession path. The goal could not continue, and its unsettled state prevented the standing lineage from starting the next goal.

## Decision

- Supersede never-bound responsibility claims like unstarted owner reasoning or workspace preparation when their source changes or their plan deadline passes. Under the owner fence, the Node proves that the binding event is absent and the assignment record unchanged, then records a version-7 `work.effect_absence` inspection and the existing `work.supervision.decision.superseded` event. The decision journal validates the inspection before treating the decision as superseded.
- Reserve a thirty-second claim admission margin before the completion deadline instead of five seconds.
- Floor the native owner's completion window at ten minutes, or the mandate's maximum deadline when shorter. Raise shorter proposals rather than rejecting them, and state the floor in owner instructions.
- Do not materialize a recovery claim if its successor responsibility can no longer accommodate the margin plus a minimal lease. Instead of a failing cycle, have the owner decide again with attention.

## Consequences

An interrupted claim no longer pins a goal in reconciliation. Rework receives at least the window a worker turn needs, eliminating the proposal/acquisition race in practice. An elapsed successor responsibility window still requires a new owner decision; recording it as a bounded assignment failure remains follow-up work.

## Verification

- `supervision-claim-supersession` runtime test: a claim failing before binding remains uncertain, is superseded after its deadline with one inspection-backed event, and permits a fresh claim over the same assignment afterwards.
- Existing claim, topology, reasoning supersession, native owner, workforce, and work-controller suites pass unchanged.

## References

- [Responsibility claim supersession](../../../../specifications/execution/outcome-supervision/implementation/recovery/decisions-and-replay/claim-supersession.md)
- [ADR-0405](0405-standing-supervision-lineage.md)
