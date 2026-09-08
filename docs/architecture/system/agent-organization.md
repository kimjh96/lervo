# Agent organization

Lervo's organization layer coordinates several repository-backed project teams over shared operating infrastructure. Each team keeps separate repository truth, knowledge, workforce, authority, budgets, workstreams, and conversation coordinates. Central policies and a CEO agent may observe and route across those boundaries but cannot silently merge them.

```text
human owner or board
  -> central CEO agent
     -> project team (Shiflo)
        -> team lead and specialist hired agents
     -> project team (Plen)
        -> team lead and specialist hired agents
     -> new project teams

shared control plane
  -> objectives and operating projections
  -> workforce, assignments, handoffs, approvals, and deliberation
  -> durable execution, resume, scheduling, and budgets
  -> knowledge, context selection, capabilities, and evidence
  -> conversation adapters and external agent identities
```

A role is a reusable contract. A hired agent is the durable expert. A provider executes one turn. A platform participant speaks for the agent, and a Discord bot is that agent's one-to-one external principal for one deployment binding. Channel membership, employment, provider choice, and execution authority are separate state transitions.

Agent context is keyed by agent ID and assembled from exact identity, work, conversation, and reviewed-expertise sources. Provider-native memory and generated summaries are projections, not authority. This keeps an agent continuous across Codex, Claude, and future providers without treating hidden model state as durable knowledge.

Ordinary agent conversation remains read-only unless an existing authority path creates or changes an assignment, workstream, approval, or external effect. Bounded discussions reuse Lervo deliberation for evidence, disagreement, decision rules, and termination, while Discord supplies distinct visible speakers.

See [ADR-0386](../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).
