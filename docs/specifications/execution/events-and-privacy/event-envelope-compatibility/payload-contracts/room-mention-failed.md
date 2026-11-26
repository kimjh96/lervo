# `room.mention.failed`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), a mention that cannot be delivered shows as a room line and as attention, and is never retried silently. Schema 15 adds this event, which records the failure. Schemas 1 through 14 reject the type.

## Fields

All three fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `mentionId`: the [`room.mention.recorded`](room-mention-recorded.md) entry, `mnt_` and 24 hex digits.
- `code`: why the mention was not delivered, one of:
  - `mention_target_inactive`: the mentioned agent is suspended or retired.
  - `room_session_unavailable`: the agent's session could not start, such as when no one is signed in to its provider.
  - `room_delivery_failed`: the session host could not write the turn to the agent's session.
  - `exchange_paused`: the exchange budget or depth bound stopped the chain.
- `occurredAt`: when the failure was observed.

## Envelope

The resident core records the event, never the ADE. It carries no message text, provider diagnostic, or provider session UUID. Readers ship first: no release records the event yet.

## Failure meaning

- The writer records the event only at schema 15 or later.
- The event is final for its mention. A new mention of the same agent is a new entry.
- A code outside the four above is refused rather than kept as an open string, so a new code needs a new reader first.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
