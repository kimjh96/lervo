# ADR-0348: Measure exact repeated verification failures

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The local improvement adapter measured verification success but left `repeated_failure`
unavailable. Treating matching error prose, exit codes, changed files, or model judgments as the
same failure would expose sensitive material and infer a root cause that canonical evidence does
not establish. Counting only failed runs would also fail to distinguish a first observed failure
from recurrence.

## Decision

Define `repeated_failure` as a repository-wide rate over an inclusive observation window. Its
denominator is every valid canonical `verification.completed` event. Its numerator is each failed
completion after the first failed completion in that window with the exact same signature. The
signature is `suiteHash` plus the ordered `nonPassedCommandIds`; passed and cancelled completions
never enter the numerator, do not reset a signature, and evidence outside the window does not seed
one. The existing version-1 comparison policy remains lower-is-favorable with a 300-basis-point
materiality threshold and a minimum denominator of ten.

Normalize and validate completion evidence once, then keep verification-success and
repeated-failure projection in separate pure modules. Increment the local adapter version to 1.1,
bind both metric policies into its descriptor, and use the existing metric-set-bound receipt and
exact apply-time re-observation. Reject duplicate verification identities, passed events with
non-passed commands, and failed events without non-passed commands. A non-empty valid window may
produce a zero numerator; an empty, over-capacity, invalid, or unsupported source remains explicitly
unavailable or failed.

Register the repository-specific `execution.orchestration.improvement` decision route with bounded
title evidence and place this decision there as its first artifact. Retain the 24-document leaf
limit and do not create an archive, capacity exception, or speculative empty hierarchy. Existing
accepted orchestration decisions remain at their canonical paths until an independently reviewed
exact move is necessary.

Do not copy command identifiers from their existing canonical event into observation receipts,
protocols, comparisons, or effect events. Derived repeated-failure evidence contains only the opaque
signature hash and existing canonical event coordinates. Add no event, state store, provider
dependency, causal authority, rollback authority, or model-learning claim.

## Consequences

An authorized host can register and compare verification success and repeated failure together from
one bounded immutable event snapshot. Exact recurrence is reproducible and privacy-bounded, while a
matching signature is deliberately described as coordinate recurrence rather than proof of the same
defect or root cause. Descriptor versioning prevents historical 1.0 observations from silently
acquiring the new metric meaning.

Future metrics still require their own exact counting unit, observable ground truth, privacy
boundary, comparison policy, abstention behavior, and adapter conformance. They do not belong in a
generic inference layer merely because their labels already exist in the application contract.

## References

- [Verified improvement effects](../../../../specifications/execution/verified-improvement-effects.md)
- [ADR-0345](../0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [ADR-0346](../0346-measure-improvement-effects-from-bounded-local-events.md)
