# Agent organization

Lervo coordinates repository-backed project teams over shared infrastructure. Each team retains separate repository truth, knowledge, workforce, authority, budgets, workstreams, and conversation coordinates. Central policies and a CEO agent may observe and route across team boundaries but cannot silently merge them.

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

A role is a reusable contract; a hired agent is the durable expert; a provider executes one turn. A platform participant speaks for the agent. A Discord bot is the agent's one-to-one external principal for one deployment binding. Channel membership, employment, provider choice, and execution authority are separate state transitions.

The `@lervo/agent-organization` domain projection replays repository events for team binding, exact hired-agent membership revisions, external-principal deployments, channel membership, and deliberation participation. It owns lifecycle invariants without depending on Discord, provider adapters, CLI parsing, or storage. The CLI owns the explicit binding mutation. The Node composition boundary hashes native Discord coordinates and validates the resulting runtime identity before opening ingress. These boundaries separate domain policy, mutation coordination, configuration parsing, and external integration.

Raw external IDs and credentials do not enter organization history. Stable hashes bind the deployment; owner-only Node configuration retains native Discord coordinates. An organization-bound runtime fails closed if any repository, team, agent, role, provider-policy, bot, configuration, or channel coordinate differs. Standalone local operation remains available when no organization binding is configured.

Agent context is keyed by agent ID and assembled from exact identity, work, conversation, and reviewed-expertise sources. Provider-native memory and generated summaries are projections, not authority. Agents remain continuous across Codex, Claude, and future providers without treating hidden model state as durable knowledge.

Ordinary agent conversation remains read-only unless an existing authority path creates or changes an assignment, workstream, approval, or external effect. Bounded discussions reuse Lervo deliberation for evidence, disagreement, decision rules, and termination; Discord supplies distinct visible speakers.

Managed conversation runs carry the durable speaking agent ID as root work causality. Provider and model remain turn execution evidence. This prevents a shared role or identical message from collapsing two agents' response ownership.

See [ADR-0386](../../decisions/coordination/conversations/0386-organization-teams-and-agent-identities.md).
