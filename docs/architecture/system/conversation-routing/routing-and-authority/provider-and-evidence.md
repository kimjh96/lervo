# Provider and evidence design

The combined managed conversation turn, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model, reasoning, and timeout choices remain adapter configuration.

## Turn evidence and history

Immutable turn evidence binds event ID, message hash, hired agent, role, provider, model, adapter version, structured effect, result digest, and resolution time without copying raw message text. A bounded platform action argument may repeat the requested nickname but never includes the full message. One result owns participation, routing, and a read reply; retries do not invoke a separate classifier.

Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content to preserve local context across restart.

## Managed-turn requirements

Managed turns retain product-default search and repository-knowledge recommendations, context selection and injection, CAS, run events, provider-session identity, deterministic writing evidence, stage timing, and observed provider token and cache telemetry. Omitting `routing.evaluation` selects the realtime deterministic publication profile; configuring it adds the independent semantic model pass.

For an owned hired-agent deployment, the same plan also requires a bounded agent-context projection. Node rebuilds it from exact reviewed promotion and handoff events, verifies every CAS summary hash and byte count, and submits it to the same context coordinator beside repository-search candidates. Missing or damaged agent context fails the managed response closed.

Discord transport cannot substitute its recent-message store for repository knowledge or bypass search, relation recommendations, context evidence, provider budgets, or run events.

Repository continuation retains managed-host workstream advancement and knowledge-current completion checks. Platform administration does not invoke repository finalization.
