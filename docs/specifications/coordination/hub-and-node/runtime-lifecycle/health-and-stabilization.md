# Health and stabilization

## Node health

Node reports event synchronization, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`. Retryable transport or validation failures report unavailable without discarding local state.

While its aggregate is `starting`, a Node refreshes the snapshot's `updatedAt` every five seconds. This proves event-loop liveness only, not component readiness.

Cache warm-ups, including the managed-conversation knowledge index, wait until the aggregate first settles as `ready` or `degraded`, with a 120-second fallback. Warm-up failure never fails the runtime ([ADR-0480](../../../../decisions/operations/services/0480-defer-node-cache-warmups-past-readiness.md)).

## Service stabilization

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart.

Removal and upgrade stop require three consecutive stopped observations within the canonical 120-second graceful stop bound. launchd keeps a booted-out job registered until its process exits.

Stabilization proves only OS continuity. Identity-bound Hub or live-process Node preflight proves readiness separately.
