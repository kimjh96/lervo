# Decision recording and replay

The composition requires a cross-process owner lease and durable decision lookup. Before dispatch, it records the decision before its effect, rechecks admission, and validates task readiness. Restart recovers the recorded plan rather than requesting a replacement from a model.

Previously recorded effects require independent inspection. Only work proven `not_started` may execute from the original decision. Uncertain or previously confirmed effects must not be blindly replayed. Effect receipts require canonical event identifiers; a failed receipt write retains an uncertain decision rather than asserting success.

A typed Node preflight failure before effect invocation retains the decision as `recorded` and reports `supervision_preflight_failed`. Repair alone does not authorize replay: the inspector must independently prove `not_started`, then admission and readiness must pass again. This distinction never converts a historical uncertain receipt, missing provider telemetry, or unknown usage into non-execution evidence.

When projecting a pending recorded decision, the task source excludes that decision's own recording event from the causal digest while still exposing it as pending. This keeps an unchanged plan eligible for the same independent effect inspection and fresh admission. Other source changes remain in the digest; a proven unstarted old-source decision must be canonically superseded before replacement planning. The pending marker alone must not suppress the original plan's action during replay.

A pending decision whose deadline has elapsed enters reconciliation even when its source digest has not changed. An `uncertain` receipt cannot be replayed. If the effect inspector proves exact non-start and the effect-specific absence adapter records canonical supersession, the owner may plan anew; uncertain inspection or failed supersession remains blocked. This also covers a launched CLI child that exits before recording a managed reservation.
For native-effect supersession, the absence adapter receives a fresh full source digest, including the pending decision. This is distinct from the admission digest used to compare the original plan and prevents an exclusion-only digest from being mistaken for the exact current event source.

Adapters must:

- Include all authority, role, assignment, review, delivery, readiness, and resource revisions in the source digest.
- Expose unresolved decisions before admitting a replacement plan.
- Retain source history through the existing event and CAS lifecycle.
- Implement recoverable idempotency for each effect.

The process-local cursor cache is only a hint: it retains at most 256 owners, checks the earliest deadline or mandate expiry, and never authorizes execution.

Unresolved decisions remain visible across source, owner, and mandate changes. The runtime independently inspects their effects even after revocation and never executes an old-source plan. Confirmed evidence can close a receipt.
