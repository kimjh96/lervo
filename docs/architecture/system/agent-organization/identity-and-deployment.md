# Identity and deployment

A role is a reusable contract; a hired agent is the durable expert; a provider executes one turn. A platform participant speaks for the agent. A Discord bot is the agent's one-to-one external principal for one deployment binding. Channel membership, employment, provider choice, and execution authority are separate state transitions.

The `@lervo/agent-organization` domain projection replays repository events for team binding, exact hired-agent membership revisions, external-principal deployments, channel membership, and deliberation participation. It owns lifecycle invariants without depending on Discord, provider adapters, CLI parsing, or storage. The CLI owns the explicit binding mutation. The Node composition boundary hashes native Discord coordinates and validates the resulting runtime identity before opening ingress. These boundaries separate domain policy, mutation coordination, configuration parsing, and external integration.

Raw external IDs and credentials do not enter organization history. Stable hashes bind the deployment; owner-only Node configuration retains native Discord coordinates. An organization-bound runtime fails closed if any repository, team, agent, role, provider-policy, bot, configuration, or channel coordinate differs. Standalone local operation remains available when no organization binding is configured.

Managed conversation runs carry the durable speaking agent ID as root work causality. Provider and model remain turn execution evidence. This prevents a shared role or identical message from collapsing two agents' response ownership.
