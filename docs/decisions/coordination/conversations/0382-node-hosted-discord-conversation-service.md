# ADR-0382: Node-hosted Discord conversation service

- Status: accepted
- Decision date: 2026-09-07

## Context

Discord remote continuation had application composition but no installed service owner. A second daemon would duplicate the per-repository configuration, Hub credential rotation, shutdown, readiness, restart, and service-manager authority owned by `lervo-node`.

The fixed queue acknowledgement is code-owned status text. Provider-model review would add cost and availability coupling and falsely imply that every fixed reply needs semantic generation.

## Decision

### Ownership and composition

The optional `discordConversation` section of strict Node runtime configuration enables one repository-scoped Discord integration. The mutually exclusive, bounded `discordConversations` collection composes distinct hired-agent speaker identities under ADR-0385 as superseded by [ADR-0394](0394-webhook-backed-discord-agent-identities.md).

`lervo-node` remains the single owner-only, always-on service. Discord configuration parsing, credential loading, application composition, per-agent runtime behavior, and aggregate Node lifecycle supervision remain separate modules.

### Credentials

Hub bearer, Discord bot tokens, and optional incoming-webhook tokens stay in owner-only regular files; configuration stores only their paths. Tokens are read at startup, remain in process memory, and are never written to health, repository events, source documentation, or conversation storage. Hub requests read the current reloadable bearer-token snapshot at request time.

### Configuration binding and fail-closed validation

Configuration binds allowed guild or direct-message scope, external channel and participant identities, Lervo conversation and participant identities, provider, role, risk, verification suites, and command lifetime. Optional routing binds provider-backed natural-language intent resolution and a distinct read-only role. Configured channels accept ordinary messages from mapped participants; bot mentions are optional attention signals.

Unknown fields, duplicate bindings, unsupported participant roles, out-of-scope tenants, insecure Gateway URLs, invalid identifiers, and unsafe credential files fail before message intake.

### Health and failure behavior

Node health adds an optional `conversation` component with states `disabled`, `pending`, `ready`, and `unavailable`. `ready` means the configured Gateway emitted authenticated READY or RESUMED state. `unavailable` contains only a bounded failure code.

Authentication rejection or invalid runtime configuration resolves the conversation supervisor failure, closes intake before repository storage, and terminates Node with `conversation_runtime_failed`. An authenticated dispatch failure is scoped to that message and reported through the interaction failure and retry contract; it does not terminate unrelated bot integrations or active provider work. The existing user service manager may apply its bounded restart policy only to terminal supervisor failures.

After self-message suppression, authenticated Discord messages without textual content are checkpointed and ignored. Embeds, attachments, joins, and other valid empty-content messages cannot terminate the Gateway. Malformed non-string or oversized content remains a dispatch failure.

### Queues and typing activity

Gateway control traffic and authenticated application dispatch use separate ordered queues. Provider latency cannot delay heartbeat acknowledgement or session sequence advancement.

When participation chooses a response, the Discord REST activity port starts a best-effort typing lease and refreshes it before Discord's ten-second expiry. Conversation composition retains one lease across response retry and ends it on success, terminal failure, abort, or a bounded safety timeout. Typing failure reports `platform_activity_failed`, creates no durable receipt, and never blocks the response.

Accepted interactions are durable before response work. Generation and publication failures remain pending with an availability time. Active work renews its inbox lease; the managed-provider deployment starts with a five-minute bounded lease to prevent ordinary model latency from causing concurrent duplicate execution.

A conversation-owned worker retries one ready interaction at a time without another platform event, including an expired lease after process interruption. Selection binds the exact current integration, participation policy, and role so historical pending records cannot gain new policy meaning or block current work. Retry provider work stays outside the Gateway control queue.

Durable-inbox inspection or advancement failure reports the privacy-bounded `interaction_retry_failed` health code and terminates the supervised Node; provider and message content are excluded.

Semantic writing evaluators pass an exact JSON schema through the common provider-adapter construction boundary. Provider-specific structured-output mechanics remain inside Codex and Claude adapters. The common evaluator validates exact check order, identifiers, states, and violation counts before publication.

### Writing contracts and evidence

Queue acknowledgements use `writing_mul-fixed-conversation-status`, a versioned multilingual contract with deterministic checks and no semantic checks. Natural conversation replies use `writing_mul-realtime-conversation` when no independent evaluator is configured, or `writing_mul-conversation` when `routing.evaluation` enables the separate fail-closed semantic pass.

The writing gate requires a separate model or human evaluator only when the contract declares semantic checks. Publication requires content-bound evaluation evidence and a permit; fixed acknowledgements emit no semantic-review claim.

### Verification

`lervo-node --check-config <config.json>` reads strict owner-only configuration and both configured credential files without starting network or repository work. The standalone distribution smoke installs the archive into a fresh external-consumer directory and runs this preflight with Discord enabled. A separate live integration fixture proves Gateway readiness, intake, queueing, Discord delivery, health, shutdown, and fail-closed supervision.

## Consequences

The installed Node service owns Discord-first remote-continuation intake without creating a competing daemon or task authority. Existing Node installations remain compatible because the single `discordConversation` form, natural-language routing, and health component remain optional.

ADR-0383 implements publishing exact-path managed-provider results back to Discord. ADR-0395 separately implements resumable native repository work. This decision's fixed acknowledgement applies only to remote continuation actually accepted by its authority path.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [Distinct Discord identities for hired agents](0385-distinct-discord-agent-identities.md)
- [User runtime service management](../../operations/services/0164-user-runtime-service-management-boundary.md)
- [Lervo Node standalone distribution](../../../distribution/node-runtime-distribution.md)
