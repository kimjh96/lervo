# Artifact delivery and recovery

## Conversation policy and projection

The conversation policy must use `proactive`, allow the `system` actor, and subscribe to `deliberation.artifact.recorded`, `deliberation.completed`, and `deliberation.attention`.

Lervo projects a writing-gated artifact only when a real participant binding exists and sends the verified body through that participant's runtime. Policy-only artifacts remain canonical internal evidence. These signals neither start another provider turn nor expose prompts, private reasoning, or provider payloads.

An inconclusive reconciliation binds its attention event to the queue's durable uncertainty time. Service restart may resume bounded inspection but must not create another Discord message for the same unresolved job.

## Artifact cursor

`deliberation-artifact-cursor.json` is an owner-only, atomic, rebuildable projection containing:

- Schema version and exact cursor kind.
- Project and integration IDs.
- Last inspected repository-event sequence.
- Update time.

First enablement starts at the current event head without replaying old deliberations. The cursor advances only after intentionally skipping an origin-less predecessor or after exactly one interaction policy durably commits an outbound.

A crash before advancement reuses deterministic event identity. A delivery failure after advancement remains owned by the interaction outbox and adapter replay.

Invalid artifact evidence, unavailable interaction ownership, or zero or multiple responding policies fails the deliberation worker without skipping the source event. A legacy artifact with no bound origin produces no Discord update and cannot satisfy installed acceptance.
