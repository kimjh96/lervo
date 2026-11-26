# `room.participant.joined`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), an agent that a turn mentions joins the conversation first when it is not yet a participant. Schema 15 adds this event, which records the join. Schemas 1 through 14 reject the type.

## Fields

All five fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `workspaceId`: the conversation, `wsp_` and 24 hex digits.
- `agentId`: the agent that joined, `agt_` and 24 hex digits.
- `providerSessionDigest`: the joined agent's own session, as the same SHA-256 digest of the provider name and session UUID that the hosted session events carry. The UUID stays in the host's launch record.
- `mentionedBy`: the agent ID whose mention brought it in, or the literal `owner`.
- `occurredAt`: when the agent joined.

## Envelope

The resident core records the event, never the ADE, in the registered repository's store, as it records the hosted session events. A workspace's worktree selects no writer of its own. The envelope has:

- `schemaVersion: 15` and `actor.kind: system`;
- `runId` `run_room_<key>` and `sessionId` `ses_room_<key>`, where `<key>` is the first 24 hex digits of the SHA-256 of the `workspaceId`. Every room event of one conversation shares this run and session; the joined agent's own session appears only in the payload.

It carries no message text, display name, path, or provider session UUID. Readers ship first: no release records the event yet, and a later release adds the writer and raises the automatic writer target.

## Failure meaning

- The writer records the event only at schema 15 or later. Below 15, the join still happens and nothing is recorded.
- A join whose session could not start records no join. It records [`room.mention.failed`](room-mention-failed.md) with `room_session_unavailable` instead.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
