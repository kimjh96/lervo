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

The object binds one integration and worker, the bot application and allowed guild or DM scope, explicit channel and human mappings, one agent participant, and the bounded managed-command policy. The [Discord service decision](../decisions/coordination/conversations/0382-node-hosted-discord-conversation-service.md) defines the fields and failure behavior.

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
        "participantId": "ptc_operator01"
      }
    ],
    "command": {
      "roleId": "developer",
      "provider": "codex",
      "risk": "medium",
      "verificationSuiteIds": ["repo.check"],
      "lifetimeMs": 120000
    }
  }
}
```

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
