# Derived status

Every report requires supervision ID, source-revision digest, owner, causal event IDs, status, reason code, assignment references, and next check time or null. Reports are projections, not a second mutable state machine.

| Status | Evidence and next responsibility |
| --- | --- |
| `planning` | Bound request awaits admitted allocation; owner plans. |
| `awaiting_start` | Dispatch without start; owner checks persisted start deadline. |
| `executing` | Admitted attempt started; await relevant events or deadline. |
| `reviewing` | Artifacts or terminal evidence returned; reviewer checks acceptance. |
| `recovering` | Failed or uncertain attempt has a recovery decision; no success claim. |
| `waiting_decision` | Exact decision exceeds authority; independent branches may run. |
| `completed` | Accepted artifacts and consistent canonical completed workstream; delivery remains separate. |
| `cancelled` | Canonical cancellation and reconciled effects; a request alone is insufficient. |

Corrupt or unavailable source evidence invalidates the report; it does not imply idle or completed status. Expired leases do not prove a provider stopped. Missing chat activity cannot erase unfinished work.

A current blocked artifact review produces `waiting_decision` with reason `acceptance_blocked` and bounded escalation, without repeatedly requesting the same review. A review for different result bytes or acceptance criteria is stale and cannot block or accept the current result.

Delivery is independently `not_attempted`, `pending`, `failed`, or `delivered`. Optional `deliveryNextCheckAt` binds a pending transport wake. Pending delivery reports `accepted_delivery_queued` without another model proposal. Failed publication with no further scheduled attempt reports `result_delivery_recovery_exhausted` and retains canonical goal completion. Only an exact transport receipt establishes `delivered`.
