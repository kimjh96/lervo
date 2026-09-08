# ADR-0382: Node-hosted Discord conversation service

- Status: accepted
- Decision date: 2026-09-07

## Context

Discord remote continuation had application composition but no installed service owner. A second daemon would duplicate per-repository configuration, Hub credential rotation, shutdown, readiness, restart, and service-manager authority already owned by `lervo-node`.

The fixed queue acknowledgement is code-owned status text. Provider-model review would add cost and availability coupling and falsely imply that every fixed reply needs semantic generation.

## Decision

The optional `discordConversation` section of strict Node runtime configuration enables one repository-scoped Discord integration. `lervo-node` remains the single owner-only, always-on service. Discord configuration parsing, credential loading, application composition, and Node lifecycle supervision remain separate modules.

The Hub bearer token and Discord bot token remain in separate owner-only regular files; configuration stores only their paths. The bot token is read at startup, stays in process memory, and is never written to health, repository events, source documentation, or conversation storage. Hub requests read the current reloadable bearer-token snapshot at request time.

Configuration binds allowed guild or direct-message scope, external channel and participant identities, Lervo conversation and participant identities, provider, role, risk, verification suites, and command lifetime. Optional routing binds provider-backed natural-language intent resolution and a distinct read-only role. A configured channel accepts ordinary messages from mapped participants; a bot mention remains an optional attention signal. Unknown fields, duplicate bindings, unsupported participant roles, out-of-scope tenants, insecure Gateway URLs, invalid identifiers, and unsafe credential files fail before message intake.

Node health adds an optional `conversation` component with states `disabled`, `pending`, `ready`, and `unavailable`. `ready` means the configured Gateway emitted authenticated READY or RESUMED state. `unavailable` contains only a bounded failure code. Authentication rejection, invalid runtime configuration, or authenticated dispatch failure resolves the conversation supervisor failure, closes intake before repository storage, and terminates the Node runtime with `conversation_runtime_failed`. The existing user service manager may then apply its bounded restart policy.

Gateway control traffic has a dedicated ordered queue; authenticated application dispatch has a separate ordered queue. Provider latency cannot delay heartbeat acknowledgement or session sequence advancement. When participation chooses a response, the Discord REST activity port starts a best-effort typing lease and refreshes it before Discord's ten-second expiry. The lease ends on success, retry, or failure. A typing failure is `platform_activity_failed`, creates no durable receipt, and never blocks the response.

The queue acknowledgement uses `writing_en-fixed-status`, a versioned English contract with deterministic checks and no semantic checks. Natural conversation replies use `writing_mul-conversation`, which requires the provider to answer in the message language and undergoes a separate semantic writing evaluation. The writing gate requires a separate model or human evaluator only when a contract declares semantic checks. Publication still requires content-bound evaluation evidence and a permit; no semantic-review claim is emitted for fixed acknowledgements.

`lervo-node --check-config <config.json>` reads the strict owner-only configuration and both configured credential files without starting network or repository work. The standalone distribution smoke installs the archive into a fresh external-consumer directory and runs this preflight with Discord enabled. The separate live integration fixture proves Gateway readiness, intake, queueing, Discord delivery, health, shutdown, and fail-closed supervision.

## Consequences

The installed Node service owns Discord-first remote-continuation intake without creating a competing daemon or task authority. Existing Node installations remain compatible because `discordConversation`, natural-language routing, and the health component are optional.

Publishing provider results back to Discord and transferring Git source bytes from an offline Mac remain separate outcomes outside this decision.

## References

- [Discord-first remote continuation intake](0381-discord-first-remote-continuation-intake.md)
- [Natural-language Discord conversation routing](0384-explicit-discord-read-and-continuation-modes.md)
- [User runtime service management](../../operations/services/0164-user-runtime-service-management-boundary.md)
- [Lervo Node standalone distribution](../../../distribution/node-runtime-distribution.md)
