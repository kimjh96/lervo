# ADR-0348: Measure exact repeated verification failures

- Status: `accepted`
- Decision date: 2026-09-02

Amended by: [ADR-0533](../../../knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). Pattern-specific intake and command behavior is retired; shared contracts remain.

## Context

The local improvement adapter measured verification success but left `repeated_failure` unavailable. Matching error prose, exit codes, changed files, or model judgments would expose sensitive material and infer a root cause unsupported by canonical evidence. Counting failed runs alone would not distinguish an initial failure from a recurrence.

## Decision

Define `repeated_failure` as a repository-wide rate over an inclusive observation window. The denominator is every valid canonical `verification.completed` event. The numerator is each failed completion after the first failed completion in that window with the exact same signature. The signature is `suiteHash` plus the ordered `nonPassedCommandIds`. Passed and cancelled completions never enter the numerator or reset a signature. Evidence outside the window does not seed a signature.

Retain the version-1 comparison policy: lower is favorable, the materiality threshold is 300 basis points, and the minimum denominator is ten.

Normalize and validate completion evidence once, then project verification success and repeated failure in separate pure modules. Increment the local adapter version to 1.1 and bind both metric policies into its descriptor. Continue using the metric-set-bound receipt and exact apply-time re-observation.

Reject duplicate verification identities, passed events with non-passed commands, and failed events without non-passed commands. A non-empty valid window may have a zero numerator. An empty, over-capacity, invalid, or unsupported source remains explicitly unavailable or failed.

Register the repository-specific `execution.orchestration.improvement` decision route with bounded title evidence and place this decision there as its first artifact. Retain the 24-document leaf limit. Do not create an archive, capacity exception, or speculative empty hierarchy. Existing accepted orchestration decisions remain at their canonical paths until an independently reviewed exact move is necessary.

Do not copy command identifiers from their existing canonical event into observation receipts, protocols, comparisons, or effect events. Derived repeated-failure evidence contains only the opaque signature hash and existing canonical event coordinates. Add no event, state store, provider dependency, causal authority, rollback authority, or model-learning claim.

## Consequences

An authorized host can register and compare verification success and repeated failure together from one bounded, immutable event snapshot. Exact recurrence is reproducible and privacy-bounded. A matching signature denotes coordinate recurrence, not proof of the same defect or root cause. Descriptor versioning prevents historical 1.0 observations from silently acquiring the new metric meaning.

Each future metric requires an exact counting unit, observable ground truth, privacy boundary, comparison policy, abstention behavior, and adapter conformance. Metrics do not belong in a generic inference layer merely because their labels exist in the application contract.

This private adapter remains outside the stock CLI's published artifact closure. A future embedding product must add reviewed release intent if it packages the adapter.

## References

- [Verified improvement effects](../../../../specifications/execution/verified-improvement-effects.md)
- [ADR-0345](0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [ADR-0346](0346-measure-improvement-effects-from-bounded-local-events.md)
