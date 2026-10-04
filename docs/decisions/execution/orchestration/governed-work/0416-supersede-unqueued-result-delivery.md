# ADR-0416: Supersede unqueued result delivery

- Status: accepted
- Decision date: 2026-09-16

## Context

The standing Lervo goal completed and recorded an admitted `publish_result` decision, but the Node stopped before writing `work.supervision.delivery.queued`. A later repository-knowledge migration changed the supervision source digest. Recovery proved the immutable outbound had never entered the delivery queue, but the generic runtime could not supersede this effect kind and indefinitely reported `pending_decision_requires_reconciliation`.

Re-executing the old decision would violate its source binding. Treating it as delivered would fabricate transport evidence. Editing the event journal would bypass the owner fence and canonical recovery contract.

## Decision

- Allow `work.result_delivery.v1` and `work.result_delivery.v2` decisions to be superseded only when their exact deterministic queue event is absent and either their source changed or their deadline elapsed.
- Record a version-8 `work.effect_absence` artifact containing the exact decision, plan, effect, replacement source, queue event, event head, observation time, and invalidation reason. Exclude result bytes, target, external message identifier, credential, and transport error.
- Under the owner lease, recheck the source digest, event head, active mandate, observation age, and queue-event absence before appending the existing `work.supervision.decision.superseded` event.
- When the decision journal replays after restart, validate both the absence artifact and continued queue-event absence. Queued or observed delivery is never eligible and retains existing idempotent retry and replay rules.

## Consequences

An administrative repository event can no longer pin a completed goal between publication admission and queueing. The owner may make a fresh contextual publication judgement against the current source without rerunning accepted worker work. Once queueing begins, the immutable outbound and existing transport recovery contract remain authoritative.

## Verification

- `result-delivery-absence` contract tests reject stale, malformed, differently bound, or extra-field evidence.
- `supervision-result-delivery-supersession` records an admitted unqueued publication, changes the task source, proves queue absence under the owner fence, replays the journal as settled, and confirms no queue event or transport call occurred.
- Installed WSL verification resumes the previously blocked standing Lervo publication and returns Node supervision health to ready.

## References

- [Independent accepted-result delivery](../../../../specifications/execution/outcome-supervision/implementation/result-delivery.md)
- [Persistence and versioned events](../../../../specifications/execution/outcome-supervision/contracts/events.md)
- [Automatic topology supersession](../../../../specifications/execution/outcome-supervision/implementation/recovery/decisions-and-replay/topology-supersession.md)
