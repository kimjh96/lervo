# Decision recording and replay

The composition requires a cross-process owner lease and durable decision lookup. Before dispatch, record the decision before its effect, recheck admission, and validate task readiness. On restart, recover the recorded plan rather than request a replacement from a model.

## Effect inspection and receipts

Independently inspect previously recorded effects. Only work proven `not_started` may execute from the original decision; uncertain or previously confirmed effects must not be blindly replayed. Effect receipts require canonical event identifiers. A failed receipt write retains an uncertain decision rather than asserting success.

A typed Node preflight failure before effect invocation retains the decision as `recorded` and reports `supervision_preflight_failed`. Repair alone does not authorize replay: an independent inspector must prove `not_started`, and admission and readiness must pass again. This distinction never turns a historical uncertain receipt, missing provider telemetry, or unknown usage into evidence of non-execution.

## Pending decisions and source digests

When projecting a pending recorded decision, the task source excludes that decision's own recording event from the causal digest but still exposes it as pending. This keeps an unchanged plan eligible for independent effect inspection and fresh admission. The pending marker alone must not suppress the original plan's action during replay.

Other source changes remain in the digest. A proven unstarted old-source decision must be canonically superseded before replacement planning.

A pending decision whose deadline has elapsed enters reconciliation even if its source digest is unchanged. An `uncertain` receipt cannot be replayed. The owner may plan anew only if the effect inspector proves exact non-start and the effect-specific absence adapter records canonical supersession. Uncertain inspection or failed supersession remains blocked. This also covers a launched CLI child that exits before recording a managed reservation.

For native-effect supersession, the absence adapter receives a fresh full source digest, including the pending decision. This differs from the admission digest used to compare the original plan: an exclusion-only digest must not be mistaken for the exact current event source.

## Adapter and runtime requirements

Adapters must:

- Include all authority, role, assignment, review, delivery, readiness, and resource revisions in the source digest.
- Expose unresolved decisions before admitting a replacement plan.
- Retain source history through the existing event and CAS lifecycle.
- Implement recoverable idempotency for each effect.

The process-local cursor cache is only a hint. It retains at most 256 owners, checks the earliest deadline or mandate expiry, and never authorizes execution.

Unresolved decisions remain visible across source, owner, and mandate changes. The runtime independently inspects their effects even after revocation and never executes an old-source plan. Confirmed evidence can close a receipt.
