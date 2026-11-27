# `room.exchange.paused`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), agent-to-agent deliveries in one conversation are bounded by ADR-0454's exchange budget and by a depth of 8. Schema 15 adds this event, which records that a bound stopped the chain. The chain stopped, and nothing was lost. Schemas 1 through 14 reject the type.

## Fields

All five fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `workspaceId`: the conversation, `wsp_` and 24 hex digits.
- `agentTurnCount`: the agent-to-agent deliveries in the current window, an integer from 0 to 1,000. A pause at the depth bound can come before the window fills.
- `limit`: the exchange budget in force, an integer from 1 to 1,000. ADR-0454's budget is 12 turns in 10 minutes. The bound of 1,000 leaves room to raise the budget without a new schema version, and it keeps a corrupted count out of the record.
- `openerAgentId`: the agent whose turn the owner started, which gets one more turn to summarize the exchange. It is null when the core saw no owner turn open the exchange, as after the resident restarted; then no agent gets that turn.
- `occurredAt`: when the exchange paused.

## Envelope

The resident core records the event, never the ADE, in the registered repository's store, as it records the hosted session events. A workspace's worktree selects no writer of its own. The envelope has:

- `schemaVersion: 15` and `actor.kind: system`;
- `runId` `run_room_<key>` and `sessionId` `ses_room_<key>`, where `<key>` is the first 24 hex digits of the SHA-256 of the `workspaceId`. Every room event of one conversation shares this run and session.

It carries no message text or display name. Readers shipped first. [ADR-0650](../../../../../decisions/distribution/0650-raise-the-event-writer-target-to-schema-16-after-its-readers.md) raises the automatic writer target to 16, so a room writer records the event once the repository's writer selects 15 or later.

## Failure meaning

- The writer records the event only at schema 15 or later.
- A pause is not a failure of the work. Whatever is left open becomes a decision for the product owner, or Lervo debt when no product owner is hired, and never waits on the owner. Each mention the pause stopped records [`room.mention.failed`](room-mention-failed.md) with `exchange_paused`.
- An owner turn resets the budget and the depth.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
