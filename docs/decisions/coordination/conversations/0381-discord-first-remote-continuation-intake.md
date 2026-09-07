# ADR-0381: Discord-first remote continuation intake

- Status: accepted
- Decision date: 2026-09-07

## Context

A person may start repository work in a local Codex or Claude terminal, take the Mac offline, and continue issuing Discord instructions through an always-on repository Node. Existing components authenticated Discord messages, replicated workstreams through the Hub, authored signed remote commands, and executed managed provider runs. They did not compose these capabilities, own a Discord Gateway connection, or bind a remote command to its intended workstream revision.

Queue acknowledgement, execution completion, provider output publication, and source checkout transfer are distinct outcomes. Combining them would misrepresent queued commands as completed and replicated workstream metadata as replicated Git bytes.

## Decision

`@lervo/discord-gateway` owns Discord Gateway v10 WebSocket Identify or Resume, heartbeat acknowledgement, reconnect, and authenticated dispatch records. `@lervo/adapter-discord` owns only Discord payload translation and REST delivery. `apps/conversation` composes the Gateway driver, platform adapter, durable interaction store, participation policy, responder, publication verification, and outbox delivery.

The Gateway keeps the bot token, Discord session ID, resume URL, sequence, heartbeat acknowledgement flag, and generated Lervo session handle in process memory. Authenticated dispatch records contain only the session handle, sequence, and event name; they are bounded and cleared on reconnect or stop. No Gateway credential or Discord session state enters repository events, source documentation, or interaction SQLite.

Terminal Discord close codes for invalid authentication, shard, API version, intents, or disallowed intents stop reconnecting and report `authentication_failed`. Invalid payloads and missed heartbeat acknowledgements trigger reconnect without treating a message as authenticated.

`HubConversationRemoteContinuation` accepts only an authenticated mapped human within configured project, conversation, and participant scopes. It reads the exact CAS-bound message, resolves one authenticated active Hub workstream head, and submits the message through the Hub-owned command-authoring HTTP boundary. Its idempotency key binds project identity, event, participant, message content hash, and continuation coordinate. The immediate Discord reply names the delivery, provider, role, workstream, and revision and claims queueing only.

The optional signed `managed_run.action.continuation` field contains `workstreamId`, `revision`, `snapshotContentHash`, nullable `assignmentId`, and nullable `agentId`. It contains no workstream body, prompt, transcript, approval, credential, or source bytes. Before provider creation, the managed provider host checks for an active local workstream with the exact ID, revision, and content hash. A mismatch fails as `managed_continuation_mismatch`; a match is also recorded in `work.causality.recorded` with the command-supplied assignment and agent coordinates.

Hub workstream absence, divergence, a completed or blocked head, peer identity drift, command-authoring drift, or local workstream lag fails closed before execution. An unchanged retry reuses the same command idempotency key and interaction/outbox records.

## Consequences

The repository has one composed path from an authenticated Discord Gateway message to an exact-workstream Hub command and a publication-verified queue acknowledgement. Commands without a continuation coordinate remain valid for backward compatibility.

This decision does not establish installed-daemon packaging for the conversation service, transfer of Git working-tree bytes from the closed Mac, or automatic return of the Node's provider result to the originating Discord thread. These separate product outcomes remain in the Discord remote continuation roadmap.

## References

- [Authenticated platform conversation adapters](0048-authenticated-platform-conversation-adapters.md)
- [Durable conversation deployment](0049-durable-conversation-deployment.md)
- [Repository-scoped workstream replication](../sync/0201-repository-scoped-workstream-replication.md)
- [Hub-owned remote command authoring](../remote-control/0146-hub-command-authoring-and-artifact-delivery.md)
- [Approval-bound managed provider Node host](../../execution/providers/0153-managed-provider-node-host.md)
- [Discord Gateway documentation](https://docs.discord.com/developers/events/gateway)
