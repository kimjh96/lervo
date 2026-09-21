# Discord peer agents

When a peer bot or webhook belongs to a deployment in another repository Node, add its reviewed immutable identity to the observing deployment. Replace example identifiers with reviewed deployment coordinates. `participantKeys` use Discord adapter coordinates; `displayName` is the exact textual address for a webhook that cannot receive a native mention. `unaddressedPriority` is the default, while `unaddressedPriorities` provides reviewed per-conversation overrides; both must match every other Node's view of this participant and conversation. The remaining values come from the peer's current workforce record and shared conversation membership.

```json
{
  "peerAgents": [
    {
      "participantKeys": ["webhook:523456789012345678"],
      "participantId": "ptc_peeragent01",
      "roleId": "developer",
      "displayName": "Ruen",
      "unaddressedPriority": 20,
      "unaddressedPriorities": {
        "cnv_project01": 0
      },
      "agentBinding": {
        "agentId": "agt_222222222222222222222222",
        "roleVersion": "1.0.0",
        "roleContractHash": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        "roleProfileHash": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
      },
      "tenantKeys": ["123456789012345678"],
      "conversationIds": ["cnv_operator01", "cnv_project01"]
    }
  ]
}
```

Bot peers can omit `displayName` when `participantKeys` contains their exact `bot:<application-id>` coordinate. Omitting the default and a conversation override means zero. Use matching overrides when a central agent should remain the General-channel owner but yield unaddressed project-channel turns to the project owner while still accepting exact mentions.
