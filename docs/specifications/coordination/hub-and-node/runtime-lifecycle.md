# Runtime lifecycle

## Health and stabilization

Node reports event synchronization, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`; retryable transport or validation failures report unavailable without discarding local state.

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart. Removal permits six observations and requires three consecutive stopped observations before deleting the definition.

Stabilization proves only OS continuity. Identity-bound Hub or live-process Node preflight proves readiness separately.

## Repository upgrades

Repository upgrade may reconcile an already registered Node by recovering the config coordinate from its exact owner-only canonical service definition. Plans expose only a config-path digest. Desired deployment identity is the SHA-256 of the shipped Node payload and its content-addressed launcher, not the semantic version alone.

Missing configuration, an unsafe service target, a legacy singleton, or degraded-but-uncertain runtime state remains explicit pending or blocked work.

## Bounded offline replacement

An exact active deployment remains upgrade-current when its only unavailable component code is `hub_unavailable`; this does not make fleet health ready.

During registered replacement, a bounded sixty-second window may produce `offline_ready` after three fresh monotonic observations from one new process only when every non-ready required component has that exact retryable code. First onboarding and every authentication, configuration, integrity, divergence, stale, mixed, or unknown failure still require complete readiness or fail closed.
