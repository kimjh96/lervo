# Example Discord configuration

Replace every identifier and path with reviewed deployment coordinates. Store the secret in the token file, not this JSON.

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
      "intent": {
        "provider": "claude",
        "model": "claude-haiku-4-5",
        "timeoutMs": 120000
      },
      "response": {
        "provider": "codex",
        "model": "gpt-5.6-sol",
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
