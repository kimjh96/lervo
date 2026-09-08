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
