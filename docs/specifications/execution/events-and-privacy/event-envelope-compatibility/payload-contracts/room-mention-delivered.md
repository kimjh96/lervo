# `room.mention.delivered`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), the session host writes each mention's turn to the mentioned agent's session and answers `room.delivered`. Schema 15 adds this event, which records the delivery. Schemas 1 through 14 reject the type.

## Fields

All three fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `mentionId`: the [`room.mention.recorded`](room-mention-recorded.md) entry, `mnt_` and 24 hex digits.
- `providerSessionDigest`: the session that received the turn, as the same SHA-256 digest of the provider name and session UUID that the hosted session events carry. The UUID stays in the host's launch record.
- `occurredAt`: when the session host wrote the turn.

## Envelope

The resident core records the event when the session host answers, never the ADE, in the registered repository's store, as it records the hosted session events. A workspace's worktree selects no writer of its own. The envelope has:

- `schemaVersion: 15` and `actor.kind: system`;
- `runId` `run_room_<key>` and `sessionId` `ses_room_<key>`, where `<key>` is the first 24 hex digits of the SHA-256 of the `workspaceId` of the mention's conversation. Every room event of one conversation shares this run and session, so the envelope names the conversation that the payload leaves out.

It carries no message text or provider session UUID. Readers ship first: no release records the event yet.

## Failure meaning

- The writer records the event only at schema 15 or later.
- Delivery means the turn was written to the session, not that the agent answered it.
- A mention that could not be delivered records [`room.mention.failed`](room-mention-failed.md) instead, never both.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
