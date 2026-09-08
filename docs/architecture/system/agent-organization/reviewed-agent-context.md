# Reviewed agent context

Agent context is keyed by agent ID and assembled from exact identity, work, conversation, and reviewed-expertise sources. Provider-native memory and generated summaries are projections, not authority. Agents remain continuous across Codex, Claude, and future providers without treating hidden model state as durable knowledge.

`agent.context.promoted` records only an exact source, content hash, CAS summary, qualifying review event, and optional supersession. `agent.context.handoff.recorded` transfers only listed entries to an active successor.

`@lervo/agent-organization` validates and projects these events; the CLI coordinates explicit mutations; Node materializes a bounded, rebuildable document and injects it as required governance context. The materializer neither searches nor chooses provider behavior.
