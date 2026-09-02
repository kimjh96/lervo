# ADR-0347: Deliver assignments through a production Slack connector

- Status: `accepted`
- Decision date: 2026-09-02

## Context

GLA8 established a safe provider-neutral assignment delivery contract and tested it with an
injected fake. That proved planning and orchestration but did not prove credential isolation,
private native destinations, actual platform failure translation, durable restart behavior,
bounded state growth, or common conformance for a production adapter. Reusing the conversation
adapter's higher-level message contract would also have mixed canonical conversation identity with
the narrower act of delivering one already-routed assignment artifact.

## Decision

Extend `@lervo/adapter-slack`, which already owns Slack authentication and Web API behavior, with a
separate `SlackAssignmentConnector`. Keep the assignment contract provider-neutral. Compose the
connector from explicit credential, destination, artifact, permit, state, and transport ports;
do not let core, the work controller, or the stock CLI read a Slack token or native identifier.

Require the concrete connector to revalidate the content-derived route plan, its inspected
descriptor and hashed destination binding, the credential's private team scope, exact artifact
bytes, and a complete schema-valid `chat` writing-publication permit before reservation. Accept at
most 4,000 characters and 16 KiB of UTF-8 text. Send plain text with markup and unfurling disabled.

Persist the reservation in a dedicated SQLite table before crossing the send boundary. Transition
it to `sending` immediately before the one transport call. Persist exactly one `delivered`,
`rejected`, or `unknown` observation. Treat a `sending` row found after restart as `unknown` and
return it as current instead of replaying. Allow later exact receipt evidence to supersede an
in-flight unknown, but never infer delivery from an HTTP status alone.

Add a shared framework-neutral connector conformance package. Every production connector must pass
the same inspection, drift, authorization, reservation ordering, replay, conflict, outcome,
uncertainty, foreign-plan, contradictory-evidence, and privacy cases. Preserve the existing fake as
an orchestration test, and add a CLI dogfood journey using the production connector with real local
CAS, permit, and SQLite boundaries plus a controlled transport.

## Privacy, state, and failure meaning

The new adapter-private durable states are `reserved`, `sending`, `delivered`, `rejected`, and
`unknown`. Rows contain only internal IDs, hashes, bounded failure codes, and timestamps. Tokens,
artifact or permit bodies, native Slack team/channel/thread/message identifiers, and unrestricted
errors are forbidden. Destination binding and receipt hashes may prove equality without making the
native values recoverable from Lervo state.

`reserved` proves authorization and pre-send persistence, not an attempted effect. `sending` proves
that the one effect boundary was crossed, not an outcome. `delivered` proves a matching Slack JSON
receipt. `rejected` means Slack returned a parseable `ok: false`. Non-success HTTP, timeout,
connection failure, malformed or mismatched success payload, and interrupted sending are `unknown`.
Unknown is not retryable automatically.

State is bounded to 100,000 records by default. Capacity exhaustion is an explicit failure.
Operator retention may remove at most 1,000 terminal records older than a reviewed timestamp per
call; unresolved rows are retained. No repository event or canonical assignment state is added.

## Consequences

A Buzz-like host can deliver one canonical handoff artifact to Slack without importing provider
policy into Lervo core or creating a collaboration database. Local and Paperclip-like operation
remain connector-independent. Live Slack delivery still requires an external app, `chat:write`
scope, workspace membership, destination configuration, credential authority, and operator
activation; repository tests do not claim those external facts.

The same conformance and private-state boundaries can support Discord, Teams, or future transports.
A second connector should reuse the public contract and conformance package while owning its native
authentication, destination, receipt, and uncertainty semantics.

## References

- [Assignment connector specification](../../../specifications/execution/assignment-connectors.md)
- [Governed loop roadmap](../../../roadmap/governed-loop-assignment-graph.md)
- [ADR-0344](0344-deliver-assignment-artifacts-through-injected-connectors.md)
- [Slack `chat.postMessage`](https://docs.slack.dev/reference/methods/chat.postMessage)
- [Slack Web API rate limits](https://docs.slack.dev/apis/web-api/rate-limits/)
