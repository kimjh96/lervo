# Reviewed agent context

Agent context is keyed by agent ID and assembled from exact identity, work, conversation, and reviewed-expertise sources. Provider-native memory and generated summaries are projections, not authority. Agents remain continuous across Codex, Claude, and future providers without treating hidden model state as durable knowledge.

`agent.context.promoted` records an exact source, CAS summary, review event, memory kind, stable subject, agent-only audience, sensitivity, confidence, opaque retrieval digests, observation and expiry coordinates, and optional supersession. The review must attest the exact summary hash; a generic successful review cannot authorize unrelated bytes. One active subject is allowed per agent and layer.

Verified managed repository-work results enter as medium-confidence, ninety-day work-outcome memory for their exact worker. Preferences, relationships, decisions, and durable expertise still require explicit reviewed promotion. Shared repository facts belong in canonical repository knowledge rather than personal context.

Node selects at most eight unexpired internal entries whose opaque retrieval digests match the current request. Restricted and unrelated entries remain locally inspectable but are not provider-injected. `agent.context.handoff.recorded` transfers only listed entries to an active successor.

`@lervo/agent-organization` validates and projects these events; the CLI coordinates explicit mutations. Node materializes a bounded, rebuildable document and injects it as required governance context. The materializer owns only deterministic bounded memory retrieval and rendering; it neither chooses provider behavior nor turns selection into a claim of provider use.
