# ADR-0416: Supersede unqueued result delivery

- Status: accepted
- Decision date: 2026-09-16

## Context

The standing Lervo goal completed and recorded an admitted `publish_result` decision, but the Node stopped before writing `work.supervision.delivery.queued`. A subsequent repository-knowledge migration changed the supervision source digest. Recovery proved that the immutable outbound had never entered the delivery queue, yet the generic runtime could not supersede this effect kind and reported `pending_decision_requires_reconciliation` indefinitely.

Re-executing the old decision would violate its source binding. Treating it as delivered would fabricate transport evidence. Editing the event journal would bypass the owner fence and canonical recovery contract.

## Decision

- Permit `work.result_delivery.v1` and `work.result_delivery.v2` decisions to be superseded only when their exact deterministic queue event is absent and either their source changed or their deadline elapsed.
- Record a version-8 `work.effect_absence` artifact containing the exact decision, plan, effect, replacement source, queue event, event head, observation time, and invalidation reason. It contains no result bytes, target, external message identifier, credential, or transport error.
- Recheck the source digest, event head, active mandate, observation age, and queue-event absence under the owner lease before appending the existing `work.supervision.decision.superseded` event.
- Validate both the absence artifact and continued queue-event absence when the decision journal replays after restart. A queued or observed delivery is never eligible for this path and retains the existing idempotent retry and replay rules.

## Consequences

An administrative repository event can no longer pin a completed goal between publication admission and queueing. The owner may make a fresh contextual publication judgement against the current source without rerunning accepted worker work. Once queueing begins, the immutable outbound and existing transport recovery contract remain authoritative.

## Verification

- `result-delivery-absence` contract tests reject stale, malformed, differently bound, or extra-field evidence.
- `supervision-result-delivery-supersession` records an admitted unqueued publication, changes the task source, proves queue absence under the owner fence, replays the journal as settled, and confirms that no queue event or transport call occurred.
- Installed WSL verification resumes the previously blocked standing Lervo publication and returns Node supervision health to ready.

## References

- [Independent accepted-result delivery](../../../../specifications/execution/outcome-supervision/implementation/result-delivery.md)
- [Persistence and versioned events](../../../../specifications/execution/outcome-supervision/contracts/events.md)
- [Automatic topology supersession](../../../../specifications/execution/outcome-supervision/implementation/recovery/decisions-and-replay/topology-supersession.md)
