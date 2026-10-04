# Authenticated exact-workstream intake

Part of [Discord remote continuation](../discord.md).

State: `installed-proven` for guild `/goal` intake; result return remains `delivery required` (see [supervision status](../../execution/outcome-supervision/delivery/status.md)).

A mapped human can mention an authorized Lervo role in Discord, bind the request to one active Hub workstream revision, queue one signed managed-provider command, and receive a publication-verified queue acknowledgement without exposing the request body.

Implemented evidence covers:

- Gateway Identify or Resume, heartbeat and reconnect, and authenticated dispatch normalization.
- Durable interaction replay, participant and conversation scope, and authenticated Hub workstream resolution.
- Deterministic command idempotency, signed continuation coordinates, managed-host fail-closed verification, and work-causality binding.
- Discord REST delivery and replay without duplicate queueing or sending.

The installed `lervo-node` service optionally owns intake. Its installed-product boundary includes separate owner-only Hub and bot credentials, Gateway-authenticated readiness, intake-first shutdown, terminal failure propagation, deployment instructions, and an installed standalone-distribution preflight.

The live Node integration fixture proves queueing and reply delivery. The packed smoke proves that an external consumer receives and validates the Discord-enabled runtime composition.
