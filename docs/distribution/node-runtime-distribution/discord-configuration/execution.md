# Discord behavior and execution settings

## Example behavior

- Every ordinary message by the mapped human in the mapped channel enters the conversation. A bot mention is accepted but not required.
- A no-capability Claude adapter resolves the natural-language turn against bounded recent conversation context and the current workstream.
- Informational intent runs the read-only managed responder through Codex with the exact workstream already injected.
- Clear repository change or continuation intent queues the command's Claude exact-workstream path.
- An allowed request to change this bot's guild nickname calls the scoped Discord current-member adapter and verifies the returned application identity and nickname. It does not queue repository work.
- Ambiguity remains read-only so the responder can clarify without changing repository or external state.
- Omitting `routing.evaluation` selects the deterministic realtime chat contract and avoids a second synchronous model call. An evaluation object enables the separate schema-constrained semantic pass without changing response provider identity.
- Each selected provider and configured model is retained at its own execution, configuration, or intent-resolution boundary.
- Discord refreshes one best-effort typing indicator during long provider work and retains it across a scheduled response retry. Indicator failure does not block the answer.
- Bounded recent turns from this bot deployment feed its responder, preserving agent-specific conversational continuity without provider-native session memory.
- Gateway heartbeat and resume handling remain independent of provider work.
- Persisted response failures retain a provider-neutral code and retry only through `maxResponseAttempts`. Exhaustion queues one fixed verified explanation instead of leaving the message silent. An unsafe retry-store failure marks conversation health unavailable as `interaction_retry_failed`.

## Participants and execution settings

Participant bindings default to `actorKind: human` and `roleId: null` when omitted. `agentId` binds the responding bot participant to an active workforce agent and derives its exact current role independently of the command role. A mapped external Discord bot can use `actorKind: agent` with an explicit role.

For hired-agent deployments, normalized inbound and outbound records retain the agent ID, exact role version, contract hash, and profile hash.

`maxResponseAttempts` accepts 1 through 10 and defaults to 3. It bounds response generation and publication attempts, not Discord REST delivery attempts, which retain their separate durable outbox policy.

Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment. Automation depth and hourly response limits remain mandatory loop controls.

The managed provider host accepts optional provider-keyed `models` and `reasoningEfforts` beside `executables`. These adapter inputs do not expand provider or role allowlists.

A changed continued command is accepted only after its exact workstream advances and repository knowledge migration, normalization, and lint are current. Discord administration does not invoke repository finalization because it cannot change repository bytes. Standalone commands retain their bounded coordinator contract.
