# Formal participation

Optional `deliberationParticipation.routes` allows this exact hired-agent deployment to accept selected formal policy seats. Every route requires `policyId` and `policyRoleId` and may override provider, model, and reasoning effort.

Configuration requires `agentId`, the exact `organization` binding, `policy.mode: proactive`, `system` in `respondTo`, and `deliberation.artifact.recorded` in `signalCodes`. Matching never uses display name, workforce role name, provider, or conversation presence.

```json
{
  "deliberationParticipation": {
    "routes": [
      {
        "policyId": "deliberation_architecture-review",
        "policyRoleId": "product-owner",
        "provider": "codex",
        "model": "gpt-6-astra",
        "reasoningEffort": "high"
      }
    ]
  }
}
```

At start, the Node resolves the route to one current organization membership, external deployment, and channel membership, then records a deterministic assignment and route hash. Before provider work, the assigned worker recomputes those coordinates and resolves the exact versioned role contract. Resume requires the identical accepted route.

The policy seat remains the deliberation responsibility. The verified workforce role supplies the participant's name, description, required inputs, context policy, and default skills.

Contributions for a bound seat are delivered exactly once through that participant's already attached bot or authorized webhook runtime, without a synthetic policy-role heading. No route creates a webhook, agent, or copied application identity. An unassigned seat remains internal review evidence and produces no Discord speaker turn.

Named formal participation currently requires the accepted agent deployment to be co-resident in the repository Node running deliberation. Ordinary cross-Node discussion uses authenticated `peerAgents`; its evidence does not imply remote formal policy-seat execution. Formal start therefore remains unavailable with only one eligible co-resident real participant, even when several cross-Node discussion peers are visible in Discord.
