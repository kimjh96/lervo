# ADR-0383: Durable conversation execution result return

- Status: accepted
- Decision date: 2026-09-07

## Context

Discord remote continuation acknowledged only that the Hub queued a command. A later managed execution receipt named the run or a bounded failure, but had no durable relation to the originating conversation. A one-shot completion callback would lose results on Node restart or loss of the Hub acknowledgement response.

A provider result does not authorize publication. Result return must verify immutable run evidence, original continuation coordinates, the result artifact, the writing contract, and the target platform limit without exposing the request, credentials, raw provider errors, or unrestricted artifact locations.

## Decision

### Durable origin and acknowledgement

Before returning the queue acknowledgement, the Node stores a bounded conversation-result record. Its origin contains delivery and command IDs, canonical conversation target and source event, policy and agent participant IDs, provider and role, exact workstream ID, revision, snapshot hash, nullable assignment and agent IDs, and queue time. It contains no message text, external Discord identifier, credential, or provider configuration. The store accepts at most 1,024 immutable origins.

The remote-command reconnect worker invokes an optional acknowledgement observer after producing a contract-valid terminal acknowledgement and before sending it to the Hub. Observer failure returns `acknowledgement_observer_failed`, leaves the Hub lease unacknowledged, and permits a later lease to replay the persisted execution receipt without rerunning the provider. Lease ID and acknowledgement time may change on transport retries; delivery, command, command hash, disposition, and execution receipt must remain identical.

For a registered conversation origin, the observer verifies the leased signed command's project, provider, role, workstream ID, revision, snapshot hash, assignment, and agent against the stored origin, then advances local state from `awaiting` to `ready`. It ignores unrelated remote commands.

Result delivery uses `ready`, `leased`, and `delivered` states, a bounded lease, and a persisted publication candidate plus outbound message. After a crash following preparation, delivery reuses the same outbound ID and the platform adapter's delivery replay contract.

### Publication requirements

Successful result publication collects at most 2,000 immutable events for the receipt's run and requires:

- One request, captured adapter result, causality record, and completion.
- One session.
- The expected project, provider, role, workstream, assignment, and agent.
- Passed verification.
- A CAS artifact whose digest matches `run.completed`.

A separate provider session evaluates the composed Discord result against the English chat writing contract and a required privacy check. Every delivery attempt rereads the evaluation artifact and exact permit.

The Discord body names delivery, run, workstream revision and snapshot hash, assignment, and agent before the verified provider result. The entire body must fit Discord's 2,000-character limit.

Rejection and execution failure publish only fixed bounded status and enumerated codes. Evidence mismatch, privacy or writing failure, evaluator failure, or an oversized result publishes a fixed blocked-publication status with the same coordinates and no provider output. Raw prompts, provider errors, credentials, external IDs, and CAS URIs are never copied into result state or status text.

### Canonical evidence and shutdown

This change adds no repository event. Managed execution events and CAS remain canonical; the owner-only result SQLite database holds durable delivery state.

Discord Gateway intake stops before shutdown waits for the remote-control cycle. Result and platform stores remain open until that cycle finishes.

## Consequences

Queue acknowledgement, execution, evidence validation, writing approval, and Discord delivery retain separate failure meanings. Result machinery is platform-neutral behind the existing conversation adapter; Discord is the first installed composition. Slack reuse starts only when Slack result return becomes a current product outcome.

Live Discord acceptance still requires an owner-authorized bot application and token, guild, channel or thread, participant mapping, Hub command authority, and an always-on Node hosting the repository after the originating Mac is offline. Unit, restart, packed-consumer, and simulated Gateway evidence do not replace that external round trip.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Node-hosted Discord conversation service](0382-node-hosted-discord-conversation-service.md)
- [Role-scoped managed conversation responses](../../release/packaging/0047-managed-conversation-responder.md)
- [Remote execution result conversation](../../../roadmap/product-outcome-convergence/host-products/discord/execution-results.md)
