# Assignment connector delivery

Status: `active`
As of: 2026-09-02

## Scope

This specification defines provider-neutral outbound delivery of one artifact already routed by a canonical workforce handoff. It adds an extension boundary for Buzz-like chat connectors without adding a chat database, inbound-message authority, room membership authority, assignment mutation, approval, provider execution, or automatic retry. Local execution and planning continue to work without a Hub or connector.

## Exact route planning

The version-1 request names the verified current workstream, assignment, handoff, canonical handoff event, artifact ID and content hash, request digest, connector descriptor, internal destination binding, and chat publication-permit coordinates. The descriptor declares only `artifact.send`, adapter-verified authentication, durable pre-send replay protection, and adapter-private external identifiers.

The pure work controller validates the request and current assignment source. A ready plan binds project and assignment revision; sender and recipient; exact handoff, event, artifact, request, connector version and descriptor hash; internal destination, integration and binding hash; and publication permit. Outbound, attempt, and plan IDs are content-derived. Missing routed artifacts, foreign workstreams, mismatched source or publication coordinates, unavailable connectors, and inactive destinations produce a blocked plan without an effect.

Plans contain no artifact body, message, prompt, path, provider response, credential, external workspace, channel, room, thread, or user identifier. `connectorId`, `destinationId`, and `integrationId` are Lervo-internal opaque bindings. Native identifiers remain inside the adapter.

## Adapter and effect boundary

`AssignmentConnectorPortV1` is host-injected. The stock CLI has no connector: it can inspect a plan but cannot apply external delivery. Apply requires the exact current plan ID, then:

1. `inspect` returns the adapter's current descriptor and internal destination binding. Any difference from the reviewed plan makes it stale and blocks before reservation.
2. `reserve` resolves and validates the full content-bound chat writing permit, exact artifact, and private native destination behind their hashes. It durably records the outbound attempt before any external effect and returns a bounded authorization receipt hash.
3. `deliver` performs at most one external attempt for that reservation and durably records one terminal observation before returning.

An adapter may use artifact and permit resolvers, but must validate bytes against the plan's content hash and must not treat caller-provided coordinates as authority. Provider-native authentication, API behavior, rate limits, identifier translation, receipts, and credential handling end inside the adapter. Core planning and evidence validation have no Slack, Discord, Teams, Hub, Codex, or Claude branch.

## States and failure meaning

A route plan is `ready` or `blocked`. Ready proves only exact current bindings. Blocked retains sorted, bounded reason codes and causes no reservation or delivery.

A durable reservation result is:

- `reserved`: the exact outbound and attempt were authenticated, authorized, and persisted before the effect; includes internal reservation ID, attempt digest, authorization receipt hash, and time;
- `current`: the same outbound already has a validated terminal delivery observation, returned without another delivery call; or
- `conflict`: another incompatible reservation owns the attempt, so no new effect is authorized.

A delivery observation is:

- `delivered`: exact receipt and idempotency-key hashes, attempt time, and delivery time were observed and durably retained;
- `rejected`: the platform definitively rejected the attempt, with bounded failure code `platform_delivery_rejected`; or
- `unknown`: delivery may have occurred but cannot be proved, with `platform_delivery_unknown`.

Rejected and unknown contain no delivery receipt, key, or success time. Unknown is never retried automatically. Before another effect, an operator must inspect adapter state and create a new reviewed contract when appropriate. A thrown adapter error is not delivery success; durable pre-send reservation prevents blind replay when a command is repeated.

No repository event is added. The workforce handoff event remains canonical route evidence; the adapter owns durable external-effect reservation and observation. Thread and inbox projections remain `deliveryState: unobserved` until a separately reviewed projection binds adapter observations into their application report. Connector success does not prove recipient attention, acknowledgment, understanding, action, review, verification, consensus, assignment creation, or provider execution.

## Adapter conformance

Every concrete connector must run the common port cases: exact inspection; stale descriptor and destination blocking; authorization failure before effect; durable reservation before effect; same-outbound replay returning `current`; reservation conflict; delivered, rejected, and unknown mapping; contradictory or foreign evidence rejection; no retry after unknown; native identifier privacy; and bounded errors. The current injected fake exercises orchestration order and replay; it is not a production connector.

## Production Slack connector

`@lervo/adapter-slack` is the first production `AssignmentConnectorPortV1`. An authorized host explicitly composes six independent boundaries: an environment-backed credential source, internal-to-native destination source, artifact source, full writing-publication permit source, durable connector state store, and Slack Web API transport. The stock CLI constructs none of them and cannot send externally.

Inspection exposes only the versioned descriptor and internal destination binding. The binding hash covers private Slack team, channel, and optional parent-thread coordinates, so native-destination drift invalidates the reviewed plan without disclosing those coordinates. The credential source reads a named environment variable at the effect boundary. The token is never accepted in a route request, descriptor, destination, reservation, observation, or SQLite record. Credential scope must match the private destination team.

Reservation resolves the exact artifact bytes and a schema-valid, content-derived `wpp_*` permit. The permit must name the `chat` surface and exact artifact ID and content hash; its canonical hash must equal the reviewed permit hash. Slack text must be non-empty valid UTF-8, at most 4,000 characters and 16 KiB, and must hash to the reviewed content. The 4,000-character limit follows Slack's recommended `chat.postMessage` size and prevents silent truncation. Markup and link or media unfurling are disabled.

The SQLite state machine is:

```text
reserved -> sending -> delivered | rejected | unknown
                  restart -------^ unknown
```

`reserved` contains internal outbound, plan, connector, destination, and reservation IDs; attempt and authorization hashes; and reservation time. `sending` adds only attempt time. Terminal rows add only hashed delivery evidence and time for `delivered`, or the bounded failure code for `rejected` and `unknown`. Rows never contain tokens, artifact text, permits, native team, channel, thread, or message identifiers, or provider error prose. Encountering `sending` after restart atomically records `unknown` and never sends again. A proven receipt may replace an in-flight `unknown` created by a concurrent observer.

The store accepts at most 100,000 records by default and fails closed at capacity. Operator-owned retention may delete only terminal rows older than an explicit timestamp and at most 1,000 per call. Unresolved reservations are not purged automatically. The common conformance runner covers stable inspection; descriptor and destination drift; authorization before effect; reservation before effect; replay; conflict; delivered, rejected, and unknown mapping; unknown non-retry; contradictory evidence; foreign plans; and native-identifier privacy.

Slack JSON responses with `ok: false` are definitive rejection. A non-success HTTP response, timeout, network failure, malformed JSON, or missing or mismatched channel or receipt is conservatively `unknown` because the effect cannot be disproved. The connector performs no automatic retry, including rate-limit retry. A repository-local dogfood journey exercises the real connector, SQLite state, CAS artifact, writing permit, CLI injection, and replay against a controlled transport; it is not evidence of live Slack workspace delivery.

## References

- [Assignment interactions](assignment-interactions.md)
- [Execution and evidence specification](../execution.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0344](../../decisions/execution/orchestration/governed-work/0344-deliver-assignment-artifacts-through-injected-connectors.md)
- [ADR-0347](../../decisions/execution/orchestration/governed-work/0347-deliver-assignments-through-a-production-slack-connector.md)
- [Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage)
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
