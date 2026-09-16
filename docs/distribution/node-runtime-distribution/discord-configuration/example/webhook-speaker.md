# Discord webhook speaker

To present a hired agent through a channel webhook while reusing the installed Gateway bot, add these fields. Every configured conversation channel requires one webhook binding. Replace identifiers and paths with reviewed deployment coordinates; keep secrets in token files.

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
