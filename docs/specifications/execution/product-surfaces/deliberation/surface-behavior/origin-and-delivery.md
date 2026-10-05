# Origin, terminal content, and delivery

## Origin-bound conversation

Discord uses one bound decision thread for the start acknowledgment, writing-gated artifact updates, and one terminal result. The main channel may receive coalesced start and terminal notices. Replies, restart recovery, and terminal delivery remain attached to the original Lervo origin.

Using the validated application query, the terminal coordinator targets exactly one conversation and thread, replies to the original source event, and mentions the requesting participant. A legacy `null` origin may fan out to configured conversations only as an operational notice; it has no reply coordinate and never fills `originDeliveryCoordinate`.

Every reply-bound outbound record carries its immediate source event and the immutable event it must answer. Synthetic deliberation signals retain their own event identity for replay; `replyToEventId` resolves the original native Discord message. Platform mapping prefers the explicit reply coordinate and may fall back to the source event only for predecessor records. A signal-generated product reply delivered as a standalone Discord message does not satisfy origin-bound acceptance.

## Terminal content

- `converged`: publish the writing-gated final decision body recovered from its canonical decision-artifact coordinate.
- `no_consensus`: state that no disputed conclusion was accepted and include the last writing-gated review.
- `failed` or inconclusive reconciliation: state plainly that no partial result was accepted.

Before publication, the coordinator verifies project, deliberation, terminal status, artifact coordinate, content hash, and bounded bytes. Missing or contradictory final artifacts leave notification retryable; status plus artifact count is never a fallback.

## Durable notification and delivery

Settlement and reconciliation atomically create a durable notification obligation:

| State | Meaning |
| --- | --- |
| `pending` | Host-ready |
| `leased` | Held by one bounded worker |
| `accepted` | The normalized event and exactly one writing-gated outbound were committed to the interaction lifecycle |

Project ID, deliberation ID, terminal summary, and settlement time are required and immutable. A lease adds worker, attempt, and expiry fields; acceptance adds a Lervo conversation-event ID and time. The obligation stores no topic, message body, principal, native Discord identifier, credential, provider payload, or delivery receipt.

An expired lease is reclaimed with its original settlement time to preserve stable event identity. Missing origin uses only the explicit legacy fallback. Missing fallback, missing interaction runtime, zero responding participation policies, or multiple responding policies leaves the obligation unaccepted and exposes a retryable configuration failure. Adapter rejection and uncertain send retain existing interaction and platform replay meanings.

`accepted` does not claim delivery. `originDeliveryCoordinate` remains `null` until the accepted event joins an outbound with valid writing evidence and a durably stored adapter receipt. Existing inbox, outbox, and platform replay contracts recover a crash after interaction acceptance without regenerating the deliberation or terminal obligation.
