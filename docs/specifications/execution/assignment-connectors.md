# Assignment connector delivery

Status: `active`
As of: 2026-09-02

## Scope

This specification defines provider-neutral outbound delivery of one artifact already routed by a
canonical workforce handoff. It adds an extension boundary for Buzz-like chat connectors without
adding a chat database, inbound-message authority, room membership authority, assignment mutation,
approval, provider execution, or automatic retry. Local execution and planning continue to work
without a Hub or connector.

## Exact route planning

The version-1 request names the verified current workstream, assignment, handoff and canonical
handoff event, one artifact ID and content hash, request digest, connector descriptor, internal
destination binding, and chat publication-permit coordinates. The descriptor declares only
`artifact.send`, adapter-verified authentication, durable pre-send replay protection, and
adapter-private external identifiers.

The pure work controller validates the request and current assignment source. A ready plan binds
project and assignment revision; sender and recipient; exact handoff, event, artifact, request,
connector version and descriptor hash; internal destination, integration and binding hash; and
publication permit. The outbound, attempt, and plan IDs are content-derived. Missing routed
artifacts, foreign workstreams, mismatched source or publication coordinates, unavailable
connectors, and inactive destinations produce a blocked plan and no effect.

Plans contain no artifact body, message, prompt, path, provider response, credential, external
workspace, channel, room, thread, or user identifier. `connectorId`, `destinationId`, and
`integrationId` are Lervo-internal opaque bindings. Native identifiers remain inside the adapter.

## Adapter and effect boundary

`AssignmentConnectorPortV1` is injected by a host. The stock CLI has no connector and therefore can
inspect a plan but cannot apply external delivery. Apply requires the exact current plan ID, then:

1. `inspect` returns the adapter's current descriptor and internal destination binding. Any
   difference from the reviewed plan is stale and blocks before reservation.
2. `reserve` resolves and validates the full content-bound chat writing permit, exact artifact, and
   private native destination behind their hashes. It durably records the outbound attempt before
   any external effect and returns a bounded authorization receipt hash.
3. `deliver` performs at most one external attempt for that reservation and durably records one
   terminal observation before returning.

An adapter may be composed with artifact and permit resolvers, but must validate bytes against the
plan's content hash and must not treat caller-provided coordinates as authority. Provider-native
authentication, API behavior, rate limits, identifier translation, receipts, and credential
handling end inside the adapter. Core planning and evidence validation have no Slack, Discord,
Teams, Hub, Codex, or Claude branch.

## States and failure meaning

The route-plan state is `ready` or `blocked`. Ready proves exact current bindings only; blocked
retains sorted bounded reason codes and causes no reservation or delivery.

The durable reservation result is:

- `reserved`: exact outbound and attempt were authenticated, authorized, and persisted before the
  effect; it includes internal reservation ID, attempt digest, authorization receipt hash, and time;
- `current`: the same outbound already has a validated terminal delivery observation, so the core
  returns it without another delivery call; or
- `conflict`: another incompatible reservation owns the attempt and no new effect is authorized.

The delivery observation is:

- `delivered`: the adapter observed and durably retained exact receipt and idempotency-key hashes
  plus attempt and delivery times;
- `rejected`: the platform definitively rejected the attempt and the bounded failure code is
  `platform_delivery_rejected`; or
- `unknown`: delivery could have occurred but cannot be proved, with
  `platform_delivery_unknown`.

Rejected and unknown contain no delivery receipt, key, or success time. Unknown is never retried
automatically. A later operator action must first inspect adapter state and create a new reviewed
contract if another effect is appropriate. A thrown adapter error is not delivery success; durable
pre-send reservation prevents blind replay on command repetition.

No new repository event is introduced. The workforce handoff event remains canonical route
evidence; the adapter owns durable external-effect reservation and observation. Thread and inbox
projections remain `deliveryState: unobserved` until a later separately reviewed projection binds
adapter observations into their application report. Connector success proves neither recipient
attention, acknowledgment, understanding, action, review, verification, consensus, assignment
creation, nor provider execution.

## Adapter conformance

Every concrete connector must run the common port cases: exact inspection, stale descriptor and
destination blocking, authorization failure before effect, durable reservation before effect,
same-outbound replay returning `current`, reservation conflict, delivered/rejected/unknown mapping,
contradictory or foreign evidence rejection, no retry after unknown, native identifier privacy, and
bounded errors. The current injected fake exercises orchestration order and replay; it is not a
production connector.

## Production Slack connector

`@lervo/adapter-slack` provides the first production `AssignmentConnectorPortV1`. An authorized
host composes it explicitly from six independent boundaries: an environment-backed credential
source, an internal-to-native destination source, an artifact source, a full writing-publication
permit source, a durable connector state store, and a Slack Web API transport. The stock CLI does
not construct these sources and remains unable to send externally.

Inspection exposes only the versioned descriptor and internal destination binding. The binding
hash covers the private Slack team, channel, and optional parent-thread coordinates, so native
destination drift invalidates the reviewed plan without disclosing those coordinates. The
credential source reads a named environment variable at the effect boundary; the token is never
accepted in a route request, descriptor, destination, reservation, observation, or SQLite record.
Credential scope must match the private destination team.

Reservation resolves the exact artifact bytes and a schema-valid, content-derived `wpp_*` permit.
The permit must name the `chat` surface and exact artifact ID and content hash, and its canonical
hash must equal the reviewed permit hash. Slack text must be non-empty valid UTF-8, at most 4,000
characters and 16 KiB, and must hash to the reviewed content. The 4,000-character bound follows
Slack's recommended `chat.postMessage` size and prevents silent truncation. Markup and link or media
unfurling are disabled.

The SQLite state machine is:

```text
reserved -> sending -> delivered | rejected | unknown
                  restart -------^ unknown
```

`reserved` contains the internal outbound, plan, connector, destination and reservation IDs;
attempt and authorization hashes; and reservation time. `sending` adds only the attempt time.
Terminal rows add only hashed delivery evidence and time for `delivered`, or the bounded failure
code for `rejected` and `unknown`. They never contain tokens, artifact text, permits, native team,
channel, thread, or message identifiers, or provider error prose. Encountering `sending` after a
restart atomically records `unknown`; it never sends again. A proven receipt may still replace an
in-flight `unknown` created by a concurrent observer.

The store accepts at most 100,000 records by default and fails closed at capacity. Operator-owned
retention may delete only terminal rows older than an explicit timestamp, at most 1,000 per call.
Unresolved reservations are not purged automatically. The common conformance runner covers stable
inspection, descriptor and destination drift, authorization before effect, reservation before
effect, replay, conflict, delivered/rejected/unknown mapping, unknown non-retry, contradictory
evidence, foreign plans, and native-identifier privacy.

Slack JSON responses with `ok: false` are definitive rejection. A non-success HTTP response,
timeout, network failure, malformed JSON, missing or mismatched channel or receipt is conservatively
`unknown`, because the effect cannot be disproved. The connector performs no automatic retry,
including rate-limit retry. A repository-local dogfood journey exercises the real connector,
SQLite state, CAS artifact, writing permit, CLI injection, and replay against a controlled transport;
it is not evidence of a live Slack workspace delivery.

## References

- [Assignment interactions](assignment-interactions.md)
- [Execution and evidence specification](../execution.md)
- [Execution events and privacy](events-and-privacy.md)
- [ADR-0344](../../decisions/execution/orchestration/0344-deliver-assignment-artifacts-through-injected-connectors.md)
- [ADR-0347](../../decisions/execution/orchestration/0347-deliver-assignments-through-a-production-slack-connector.md)
- [Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage)
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
