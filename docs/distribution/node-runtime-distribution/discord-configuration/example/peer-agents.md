# Discord peer agents

When a peer webhook belongs to a deployment in another repository Node, add its reviewed immutable identity to the observing deployment. Replace example identifiers with reviewed deployment coordinates. `participantKeys` use Discord adapter coordinates; the remaining values come from the peer's current workforce record and shared conversation membership.

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
