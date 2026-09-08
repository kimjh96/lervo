# Discord configuration

Optional `discordConversation` enables one Discord-first remote-continuation identity in the same Node service. The mutually exclusive `discordConversations` array enables one to eight distinct bot identities. Keep the Hub token, every bot token, and configuration as separate mode-0600 regular files.

Each object binds an integration and worker, the bot application and allowed guild or DM scope, explicit channel and participant mappings, one agent participant, and a bounded managed-command policy. Optional `routing` adds no-capability natural-language intent resolution with a distinct read-only execution role. Decisions linked from the [distribution entrypoint](../node-runtime-distribution.md) define fields and failure behavior.

## Multiple bot identities

For multiple visible role agents, put complete objects of the same shape in `discordConversations`. Each requires a distinct application ID, token file, integration ID, worker ID, agent participant ID, and hired `agentId`.

Shared external channels must use the same `conversationId`. Peer bot author and mention identities are bound automatically; do not also list those application IDs in `participants`. Preflight validates every token. Runtime conversation health reaches `ready` only after every configured bot is ready.

## Example configuration

Replace every identifier and path with reviewed deployment coordinates. The token file contains the secret, not this JSON:

```json
{
  "discordConversation": {
    "integrationId": "itg_discord01",
    "applicationId": "999999999999999999",
    "botTokenFile": "/absolute/private/discord.token",
    "intents": 37377,
    "allowedGuildIds": ["123456789012345678"],
    "allowDirectMessages": false,
    "workerId": "discord-operator",
    "agentParticipantId": "ptc_lervoagent",
    "agentId": "agt_111111111111111111111111",
    "conversations": [
      {
        "tenantKey": "123456789012345678",
        "conversationKey": "223456789012345678",
        "conversationId": "cnv_operator01"
      }
    ],
    "participants": [
      {
        "tenantKey": "123456789012345678",
        "userId": "323456789012345678",
        "participantId": "ptc_operator01",
        "actorKind": "human",
        "roleId": null
      }
    ],
    "routing": {
      "readOnlyRoleId": "conversation-reader",
      "intent": {
        "provider": "claude",
        "model": "claude-haiku-4-5",
        "timeoutMs": 120000
      },
      "response": {
        "provider": "codex",
        "model": "gpt-5.6-sol",
        "reasoningEffort": "low"
      },
      "evaluation": {
        "provider": "claude",
        "model": "claude-haiku-4-5",
        "reasoningEffort": "low"
      }
    },
    "command": {
      "roleId": "developer",
      "provider": "claude",
      "risk": "medium",
      "verificationSuiteIds": ["repo.check"],
      "lifetimeMs": 120000
    },
    "policy": {
      "respondTo": ["human"],
      "maxResponseAttempts": 3
    }
  }
}
```

## Example behavior

- Every ordinary message by the mapped human in the mapped channel enters the conversation. A bot mention is accepted but not required.
- A no-capability Claude adapter resolves the natural-language turn against bounded recent conversation context and the current workstream.
- Informational intent runs the read-only managed responder through Codex with the exact workstream already injected.
- Clear change or continuation intent queues the command's Claude exact-workstream path.
- Ambiguity remains read-only so the responder can clarify without changing repository or external state.
- A separate Claude evaluator verifies publication writing without changing response provider identity. It requests schema-constrained output through the selected provider adapter, then validates the exact common evaluation contract.
- Each selected provider and configured model is retained at its own execution, configuration, or intent-resolution boundary.
- Discord refreshes a best-effort typing indicator during long provider work. Indicator failure does not block the answer.
- Bounded recent turns from this bot deployment are supplied to its responder, preserving agent-specific conversational continuity without provider-native session memory.
- Gateway heartbeat and resume handling remain independent of provider work.
- Persisted response failures retain a provider-neutral code and retry only through `maxResponseAttempts`. Exhaustion queues one fixed verified explanation instead of leaving the message silent. An unsafe retry-store failure marks conversation health unavailable as `interaction_retry_failed`.

## Participants and execution settings

Participant bindings default to `actorKind: human` and `roleId: null` when omitted. `agentId` binds the responding bot participant to an active workforce agent and derives its exact current role independently of the command role. A mapped external Discord bot can use `actorKind: agent` with an explicit role.

For hired-agent deployments, normalized inbound and outbound records retain the agent ID, exact role version, contract hash, and profile hash. `maxResponseAttempts` accepts 1 through 10 and defaults to 3. It bounds response generation and publication attempts, not Discord REST delivery attempts, which retain their separate durable outbox policy.

Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment. Automation depth and hourly response limits remain mandatory loop controls.

The managed provider host accepts optional provider-keyed `models` and `reasoningEfforts` beside `executables`. These adapter inputs do not expand provider or role allowlists.

A changed continued command is accepted only after its exact workstream advances and repository knowledge migration, normalization, and lint are current. Standalone commands retain their bounded coordinator contract.
