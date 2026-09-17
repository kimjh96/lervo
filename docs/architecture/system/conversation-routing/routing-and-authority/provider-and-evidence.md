# Provider and evidence design

The combined managed conversation turn, independent writing evaluation, and write continuation select providers independently. Codex and Claude implement common provider-neutral ports; model, reasoning, and timeout choices remain adapter configuration.

## Turn evidence and history

Immutable turn evidence binds event ID, message hash, hired agent, role, provider, requested model, provider-observed answer model, every observed model identifier, adapter version, structured effect, result digest, and resolution time without copying raw message text.

Requested configuration never proves the runtime model. Codex binds the effective model returned by app-server thread start or the Responses result object. Claude binds the answer-producing root assistant model separately from all `modelUsage` identifiers so helper usage cannot become the claimed answer model. If the provider cannot prove the answer model, evidence records an explicit unavailable reason, never a default, alias, or guess.

A bounded platform action argument may repeat the requested nickname but never includes the full message. One result owns participation, routing, and a read reply; retries reuse the content-and-model-identity artifact instead of invoking a separate classifier.

Managed-run events separately record the actual response or command provider. Conversation history reuses completed interaction records and CAS content to preserve local context across restart.

## Managed-turn requirements

Managed turns retain product-default search and repository-knowledge recommendations, context selection and injection, CAS, run events, provider-session identity, deterministic writing evidence, stage timing, and observed provider token and cache telemetry. Omitting `routing.evaluation` selects the realtime deterministic publication profile for managed read and clarification replies; configuring it adds their independent semantic model pass. Repository-work, goal, continuation, control, and platform-action responders keep their own mode-specific publication contracts. The final verifier resolves that same contract from the selected mode, so an optional read evaluator cannot invalidate unrelated response evidence. `routing.resultEvaluation` independently selects completed execution-result publication review, allowing a stronger reviewer without putting it in the ordinary conversation latency path.

For an owned hired-agent deployment, the same plan also requires a bounded agent-context projection. Node rebuilds it from exact reviewed promotion and handoff events, verifies every CAS summary hash and byte count, and submits it to the same context coordinator beside repository-search candidates. Missing or damaged agent context fails the managed response closed.

Discord transport cannot substitute its recent-message store for repository knowledge or bypass search, relation recommendations, context evidence, provider budgets, or run events.

Code inspection, code excerpts, repository mutation, verification, and durable result return remain managed application capabilities. Discord and a future first-party interface invoke those same ports; neither reimplements provider execution or owns agent context.

Repository continuation retains managed-host workstream advancement and knowledge-current completion checks. Platform administration does not invoke repository finalization.
