# ADR-0346: Measure improvement effects from bounded local events

- Status: `accepted`
- Decision date: 2026-09-02

## Context

The verified-improvement contract could bind adapter-verified baseline and treatment rates, but no
production adapter could derive those rates. Accepting caller-provided counts unchanged would make
the verification port ceremonial. Inferring source recall, rework, correction, or repeated failure
from loosely related events would create measurements whose units and ground truth were undefined.

## Decision

Add a storage-neutral optional collection contract for authorized request preparation and retain
`ImprovementObservationPortV1` as the narrower apply-time authority. Put reusable conformance in a
separate package. Put event-store scanning, pure verification-success projection, receipt binding,
and project-storage lifetime composition in separate modules of a local observation adapter.

Version 1 of the local adapter supports only repository-wide verification success: passed canonical
`verification.completed` events divided by every valid completion in an inclusive window. Bind its
receipt to the adapter descriptor, phase, pattern, window, metric, counts, and selected evidence.
Re-observe at exact apply, reject duplicate identities and drift, and expose unsupported, empty, and
over-capacity observations as unavailable rather than inferred zeroes.

Keep the stock CLI without a default observation adapter. An embedding host must explicitly create
and inject the local adapter. The adapter reads existing privacy-allowlisted canonical events and
creates no event, projection, approval, rollback, or provider authority of its own.

## Consequences

Lervo can now dogfood one exact local outcome metric without a Hub, credentials, or provider-specific
logic. Appended evidence inside an old window invalidates its prior receipt, while irrelevant later
events do not. The scan and selected evidence sets have fixed bounds, and project storage is closed
on both success and failure.

The remaining metrics require their own observable units, event evidence, ground-truth sources, and
versioned policy. This adapter does not establish causation, correctness, semantic use, model-weight
learning, or automatic rollback authority.

## References

- [Verified improvement effects](../../../specifications/execution/verified-improvement-effects.md)
- [ADR-0345](0345-observe-reviewed-improvement-effects-without-self-learning-claims.md)
- [Reader-first causal observability](../../operations/trace/0331-adopt-reader-first-causal-work-observability.md)
