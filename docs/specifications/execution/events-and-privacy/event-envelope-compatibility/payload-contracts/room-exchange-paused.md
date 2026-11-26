# `room.exchange.paused`

In [Lervo ADE rooms](../../../product-surfaces/ade-rooms.md), agent-to-agent deliveries in one conversation are bounded by ADR-0454's exchange budget and by a depth of 8. Schema 15 adds this event, which records that a bound stopped the chain. The chain stopped, and nothing was lost. Schemas 1 through 14 reject the type.

## Fields

All five fields are required, and no other key is kept: the payload screen drops any other field before validation.

- `workspaceId`: the conversation, `wsp_` and 24 hex digits.
- `agentTurnCount`: the agent-to-agent deliveries in the current window, an integer of at least 0. A pause at the depth bound can come before the window fills.
- `limit`: the exchange budget in force, an integer of at least 1.
- `openerAgentId`: the agent whose turn the owner started, which gets one more turn to summarize the exchange. It is null when the core saw no owner turn open the exchange, as after the resident restarted; then no agent gets that turn.
- `occurredAt`: when the exchange paused.

## Envelope

The resident core records the event, never the ADE. It carries no message text or display name. Readers ship first: no release records the event yet.

## Failure meaning

- The writer records the event only at schema 15 or later.
- A pause is not a failure of the work. Whatever is left open becomes a decision for the product owner, or Lervo debt when no product owner is hired, and never waits on the owner. Each mention the pause stopped records [`room.mention.failed`](room-mention-failed.md) with `exchange_paused`.
- An owner turn resets the budget and the depth.
- A payload outside this closed shape is refused, and the envelope refuses the type below schema 15.
