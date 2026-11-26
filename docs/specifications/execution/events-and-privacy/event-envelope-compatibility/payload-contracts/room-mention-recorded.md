# `room.mention.recorded`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), each mention of a team agent in a conversation becomes one entry in the room's mention log. Schema 15 adds this event, which records that entry. Schemas 1 through 14 reject the type.

## Fields

All six fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `workspaceId`: the conversation, `wsp_` and 24 hex digits.
- `mentionId`: the mention log entry, `mnt_` and 24 hex digits. [`room.mention.delivered`](room-mention-delivered.md) and [`room.mention.failed`](room-mention-failed.md) name it.
- `fromAgentId`: the mentioning agent, `agt_` and 24 hex digits, or null when the owner mentioned.
- `toAgentId`: the mentioned agent, `agt_` and 24 hex digits.
- `depth`: the delivery's depth from the turn that started the chain, an integer from 0 to 8. The exchange pauses rather than go deeper.
- `occurredAt`: when the mention was recorded.

## Envelope

The resident core records the event, never the ADE, in the registered repository's store, as it records the hosted session events. A workspace's worktree selects no writer of its own. The envelope has:

- `schemaVersion: 15` and `actor.kind: system`;
- `runId` `run_room_<key>` and `sessionId` `ses_room_<key>`, where `<key>` is the first 24 hex digits of the SHA-256 of the `workspaceId`. Every room event of one conversation shares this run and session.

It carries no message text, display name, or provider session UUID; the text stays in the providers' transcripts. Readers ship first: no release records the event yet.

## Failure meaning

- The writer records the event only at schema 15 or later. Below 15, the mention is still delivered and nothing is recorded.
- Each recorded mention ends in at most one `room.mention.delivered` or `room.mention.failed`. A mention with neither was still pending when the resident stopped.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
