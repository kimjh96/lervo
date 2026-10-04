# Commands and subscriptions

## Steering commands

Live steering has no generic `surface.mutate` route. Each action resolves to its owning typed domain command and preserves plan/apply, approval, lease, idempotency, and failure contracts.

`ProductSteeringCommandV1` is a body-free application envelope binding a content-derived command ID and digest, action, owning domain and domain-command coordinate, target and expected target revision, principal, origin binding, hashed command input, idempotency digest, authority coordinates, and request time.

| Action | Owning domain |
| --- | --- |
| `amend` | `objective` or `assignment` |
| `pause`, `resume`, `cancel` | `execution` |
| `approve` | `policy`, with an approval coordinate |
| `retry` | `attempt` |
| `reassign` | `assignment` |
| `handoff` | `source_lifecycle`, with an exact plan coordinate |

`ProductSteeringResultV1` binds the command, source event head, repository revision, result digest, and optional owning-domain receipt:

- `applied` requires a receipt.
- `no_effect` names a bounded reason.
- `blocked` and `rejected` prove no applied effect.
- `uncertain` carries no success receipt and requires inspection through the owning domain before any retry.

Formal deliberation uses its existing typed start, inspect, and resume authority. A recommendation to deliberate is a query result, not a command. Ordinary conversation, mentions, relevance, and generic steering actions cannot be translated into a deliberation start.

## Activity subscriptions

Subscriptions provide activity invalidation or bounded new-page hints with exact cursors. They neither carry canonical bodies nor replace source queries. Lost or reordered hints trigger cursor-based replay, not inferred state or an unbounded full-history push.

`ProductActivitySubscriptionRequestV1` binds an opaque subscription ID, origin, authorization digest, nullable resume cursor, maximum page size, and request digest.

`ProductActivitySubscriptionHintV1` carries only the subscription ID, monotonic sequence, observation time, previous and current cursor, event-head and repository revision, status, bounded reason, and digest:

- `changed` supplies a current cursor for a bounded page query.
- `heartbeat` asserts no new body or completion meaning.
- `resync_required` clears the current cursor and requires replay from a verified source coordinate.
- `closed` names a bounded closure reason.

## Evidence and privacy boundaries

Commands and hints exclude request prose, event bodies, result bodies, prompts, reasoning, credentials, unrestricted paths, native platform identifiers, and provider payloads. Hashes and opaque Lervo coordinates are correlation evidence, not authority by themselves.
