# Discord remote continuation

Part of [Paperclip-, Buzz-, loop-, graph-, and host-product outcomes](../host-products.md); the product-convergence acceptance baseline and state definitions apply.

## Authenticated exact-workstream intake

Outcome: a mapped human can mention an authorized Lervo role in Discord, bind the request to one active Hub workstream revision, queue one signed managed-provider command, and receive a publication-verified queue acknowledgement without exposing the request body.

State: `delivery required`.

Implemented evidence covers Gateway Identify or Resume, heartbeat and reconnect, authenticated dispatch normalization, durable interaction replay, participant and conversation scope, authenticated Hub workstream resolution, deterministic command idempotency, signed continuation coordinates, managed-host fail-closed verification, work-causality binding, Discord REST delivery, and replay without duplicate queueing or sending.

Completion requires an installed service entrypoint with owner-only bot and Hub credential loading, readiness and shutdown behavior, deployment documentation, and a packed external-consumer journey. Lower-level application composition is not installed-product acceptance.

## Remote execution result conversation

Outcome: managed execution completion, failure, and a publication-approved result return to the originating Discord thread with exact delivery, run, workstream, and assignment coordinates.

State: `delivery required`.

The current acknowledgement proves queueing only. Hub receipts contain verified run identity and completion status but intentionally exclude provider output. Completion requires a bounded result-publication contract and durable correlation; it must not expose raw prompts, provider errors, credentials, unrestricted CAS URIs, or unverified output.

## Mac-offline source handoff

Outcome: after a deliberate local handoff, the always-on repository Node has the exact authorized source revision and workstream checkpoint needed to continue while the originating Mac is offline.

State: `delivery required`.

Workstream replication transfers bounded continuation metadata, not Git bytes or uncommitted changes. Completion requires a reviewed source handoff, remote revision verification before command acceptance, divergence handling, and a later verified hand-back. It must not silently push, discard, merge, or overwrite user-owned changes.

## References

- [Discord-first remote continuation intake](../../../decisions/coordination/conversations/0381-discord-first-remote-continuation-intake.md)
- [Agent workspace lifecycle](../../../roadmap/onboarding/agent-workspace-lifecycle.md)
- [Repository-scoped workstream replication](../../../decisions/coordination/sync/0201-repository-scoped-workstream-replication.md)
