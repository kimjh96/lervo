# Health and stabilization

Node reports event synchronization, workstream replication, and remote control as separate health components. Workstream divergence reports `divergent_heads`. Retryable transport or validation failures report unavailable without discarding local state.

Service installation requires a canonical definition and write authority. New Hub or Node activation must remain installed, enabled where applicable, and active across three observations 500 milliseconds apart.

Removal and upgrade stop require three consecutive stopped observations within the canonical 120-second graceful stop bound: launchd keeps a booted-out job registered until its process exits.

Stabilization proves only OS continuity. Identity-bound Hub or live-process Node preflight proves readiness separately.
