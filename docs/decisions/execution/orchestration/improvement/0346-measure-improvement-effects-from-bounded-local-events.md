# ADR-0346: Measure improvement effects from bounded local events

- Status: `accepted`
- Decision date: 2026-09-02

Amended by: [ADR-0533](../../../knowledge/repository/canonicalization/patterns/0533-remove-the-development-pattern-pipeline.md). Pattern-specific intake and command behavior is retired; shared contracts remain.

## Context

The verified-improvement contract could bind adapter-verified baseline and treatment rates, but no production adapter could derive them. Accepting caller-provided counts unchanged would make the verification port ceremonial. Inferring source recall, rework, correction, or repeated failure from loosely related events would produce measurements without defined units or ground truth.

## Decision

Add a storage-neutral, optional collection contract for authorized request preparation, while retaining `ImprovementObservationPortV1` as the narrower apply-time authority. Place reusable conformance in a separate package. Separate the local observation adapter's event-store scanning, pure verification-success projection, receipt binding, and project-storage lifetime composition into distinct modules.

Version 1 of the local adapter supports only repository-wide verification success: passed canonical `verification.completed` events divided by all valid completions in an inclusive window. Bind each receipt to the adapter descriptor, phase, pattern, window, metric, counts, and selected evidence. Re-observe at exact apply, reject duplicate identities and drift, and report unsupported, empty, and over-capacity observations as unavailable rather than inferred zeroes.

The stock CLI has no default observation adapter. An embedding host must explicitly create and inject the local adapter. The adapter reads existing privacy-allowlisted canonical events and creates no event, projection, approval, rollback, or provider authority.

## Consequences

Lervo can dogfood one exact local outcome metric without a Hub, credentials, or provider-specific logic. Evidence appended inside an old window invalidates its prior receipt; irrelevant later events do not. Scan and selected-evidence sets have fixed bounds, and project storage closes on both success and failure.

Remaining metrics require their own observable units, event evidence, ground-truth sources, and versioned policy. This adapter establishes neither causation, correctness, semantic use, model-weight learning, nor automatic rollback authority.

## References

- Verified improvement effects specification, removed by [ADR-0560](../../../foundation/0560-remove-unused-subsystems-to-harden-the-core.md)
- [ADR-0345](0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [Reader-first causal observability](../../../operations/trace/0331-adopt-reader-first-causal-work-observability.md)
