# Example Discord configuration

Replace every identifier and path with reviewed deployment coordinates. Store the secret in the token file, not in this JSON.

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
    "administration": {
      "allowedActions": ["current_member.nickname.set"]
    },
    "routing": {
      "readOnlyRoleId": "conversation-reader",
      "response": {
        "provider": "codex",
        "model": "gpt-5.6-sol",
        "reasoningEffort": "low",
        "timeoutMs": 60000
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
      "mode": "proactive",
      "respondTo": ["human", "agent", "system"],
      "signalCodes": ["work.completed"],
      "maxResponseAttempts": 3
    },
    "repositorySignals": {
      "pollIntervalMs": 2000,
      "mappings": [
        {
          "eventType": "run.completed",
          "signalCode": "work.completed",
          "conversationIds": ["cnv_operator01"]
        }
      ]
    },
    "deliberation": {
      "cliExecutable": "/absolute/bin/lervo",
      "workerId": "discord-deliberation",
      "principals": [
        {
          "participantId": "ptc_operator01",
          "principalId": "owner:operator",
          "permissions": [
            "deliberation.start",
            "deliberation.resume",
            "deliberation.read"
          ]
        }
      ],
      "pollIntervalMs": 2000,
      "leaseDurationMs": 300000,
      "processTimeoutMs": 900000
    }
  }
}
```

To present a hired agent through a channel webhook while reusing the installed Gateway bot, add these fields. Every configured conversation channel requires one webhook binding.

```json
{
  "speaker": {
    "kind": "webhook",
    "webhooks": [
      {
        "channelId": "223456789012345678",
        "webhookId": "423456789012345678",
        "tokenFile": "/absolute/private/discord-webhooks/ceoe_webhook01.token"
      }
    ],
    "avatarUrl": "https://assets.example.com/agents/arac.png"
  },
  "administration": {
    "allowedActions": ["incoming_webhook.create"],
    "webhookCredentialDirectory": "/absolute/private/discord-webhooks"
  }
}
```

The runtime uses the hired agent's durable display name as the webhook username. The optional avatar must use HTTPS without URL credentials.

When a peer webhook belongs to a deployment in another repository Node, add its reviewed immutable identity to the observing deployment. `participantKeys` use Discord adapter coordinates; the remaining values come from the peer's current workforce record and shared conversation membership.

```json
{
  "peerAgents": [
    {
      "participantKeys": ["webhook:523456789012345678"],
      "participantId": "ptc_peeragent01",
      "roleId": "developer",
      "agentBinding": {
        "agentId": "agt_222222222222222222222222",
        "roleVersion": "1.0.0",
        "roleContractHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "roleProfileHash": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      },
      "tenantKeys": ["123456789012345678"],
      "conversationIds": ["cnv_operator01"]
    }
  ]
}
```
