# Lervo Node standalone distribution

This platform-specific distribution runs without an npm registry or Lervo source checkout.

- Entry point: `dist/bin.js`
- Runtime: Node.js 22.13 or later
- Version: the owning Lervo product release from the public `@lervo/cli` manifest
- Excludes configuration, bearer tokens, trust keys, CA certificates, and repositories
- Verify included files and the dependency closure against `lervo-node-distribution.manifest.json` and `sbom.cdx.json`
- Successful installation does not prove Hub connectivity, provider authentication, service activation, or readiness

## Installation and preflight

Obtain the archive SHA-256 through a separate trusted channel and compare it with the platform SHA-256 tool. Extract into a new, previously absent directory, then run:

```sh
node dist/bin.js --config <config.json>
```

Before activation, run the owner-only configuration and credential preflight. It performs no network or repository work:

```sh
node dist/bin.js --check-config <config.json>
```

## Discord configuration

An optional `discordConversation` object enables Discord-first remote continuation in the same Node service. Keep `hub.bearerTokenFile`, `discordConversation.botTokenFile`, and the configuration itself as separate mode-0600 regular files.

The object binds one integration and worker, the bot application and allowed guild or DM scope, explicit channel and participant mappings, one agent participant, and the bounded managed-command policy. Optional `routing` adds no-capability natural-language intent resolution with a distinct read-only execution role. The [Discord service decision](../decisions/coordination/conversations/0382-node-hosted-discord-conversation-service.md) and [routing decision](../decisions/coordination/conversations/0384-explicit-discord-read-and-continuation-modes.md) define the fields and failure behavior.

The required Discord shape follows. Replace every identifier and path with reviewed deployment coordinates; the token file contains the secret, not this JSON:

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
        "provider": "codex",
        "model": "gpt-5.3-codex",
        "timeoutMs": 120000
      },
      "response": {
        "provider": "claude",
        "model": "claude-sonnet-4-6"
      }
    },
    "command": {
      "roleId": "developer",
      "provider": "codex",
      "risk": "medium",
      "verificationSuiteIds": ["repo.check"],
      "lifetimeMs": 120000
    },
    "policy": {
      "respondTo": ["human"]
    }
  }
}
```

With this example, every ordinary message by the mapped human in the mapped channel enters the conversation. A bot mention is accepted but not required. A no-capability Codex adapter resolves the natural-language turn against bounded recent conversation context and the current workstream. Informational intent runs the read-only managed responder through Claude, clear change or continuation intent queues the command's Codex exact-workstream path, and ambiguity remains read-only so the responder can ask for clarification without changing repository or external state. Each selected provider and model is recorded at its own execution or intent-resolution boundary. Once participation selects a response, Discord shows a best-effort typing indicator refreshed during long provider work; its failure does not block the answer. Gateway heartbeat and resume handling remain independent of that work.

Participant bindings default to `actorKind: human` and `roleId: null` when those fields are omitted. A mapped Discord bot can instead use `actorKind: agent` with an explicit role. Add `agent` to `policy.respondTo` only for a bounded agent conversation or deliberation deployment; automation depth and hourly response limits remain mandatory loop controls.

## Service activation and readiness

On a host with Lervo repository tools, `node:distribution:install` can verify `--expected-sha256` and install into a new target. Prepare owner-only configuration separately, then explicitly activate the Node with the service renderer and manager.

For standalone `dist/bin.js`, pass its path as `--executable` and a verified Node.js binary as `--node-executable`. Service activation must not rely on ambient `PATH` or a separate launcher.

After preflight, render and explicitly install the existing per-repository Node service. It starts `lervo-node --config`, keeps Discord and synchronization under one process lifecycle, restarts only on failure, and writes no credentials into the service definition:

```sh
pnpm service:render --manager launchd --runtime node --instance <nfi-id> \
  --executable <absolute-installed-path>/dist/bin.js \
  --node-executable <absolute-node-path> --config <absolute-config-path> \
  --output <new-absolute-definition-path>
pnpm service:manage install --source <absolute-definition-path> --write
```

Use `--manager systemd` on Linux. Service-manager stability and the owner-only health snapshot are separate checks. Discord readiness appears as `conversation.status: ready` only after Gateway READY or RESUMED authentication.

## Release identity

Private workspace package versions are implementation coordinates, not operational Node release identifiers. The embedded package manifest, SBOM root, distribution manifest, and artifact sidecar must all match the public Lervo product version.
