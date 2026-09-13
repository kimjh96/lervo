# Decision recording and replay

The composition requires a cross-process owner lease and durable decision lookup. Before dispatch, it records the decision before its effect, rechecks admission, and validates task readiness. Restart recovers the recorded plan rather than requesting a replacement from a model.

Previously recorded effects require independent inspection. Only work proven `not_started` may execute from the original decision. Uncertain or previously confirmed effects must not be blindly replayed. Effect receipts require canonical event identifiers; a failed receipt write retains an uncertain decision rather than asserting success.

A typed Node preflight failure before effect invocation retains the decision as `recorded` and reports `supervision_preflight_failed`. Repair alone does not authorize replay: the inspector must independently prove `not_started`, then admission and readiness must pass again. This distinction never converts a historical uncertain receipt, missing provider telemetry, or unknown usage into non-execution evidence.

Adapters must:

- Include all authority, role, assignment, review, delivery, readiness, and resource revisions in the source digest.
- Expose unresolved decisions before admitting a replacement plan.
- Retain source history through the existing event and CAS lifecycle.
- Implement recoverable idempotency for each effect.

The process-local cursor cache is only a hint: it retains at most 256 owners, checks the earliest deadline or mandate expiry, and never authorizes execution.

Unresolved decisions remain visible across source, owner, and mandate changes. The runtime independently inspects their effects even after revocation and never executes an old-source plan. Confirmed evidence can close a receipt.
