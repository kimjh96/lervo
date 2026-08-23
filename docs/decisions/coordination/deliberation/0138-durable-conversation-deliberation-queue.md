# ADR-0138: Durable Conversation Deliberation Queue

- Status: accepted
- Decision date: 2026-08-22

## Context

Running long deliberations inside an interaction lease risks duplicates. A process can also persist project effects and die before committing the queue result, which SQLite cannot atomically combine with those effects.

## Decision

@lervo/conversation-control defines a job-store port, queued backend, one-cycle worker, and provider-neutral execution port. The backend derives a deterministic dlb_ ID from projectId and sourceEventId, reserves a request hash over principal/policy/topic, and immediately returns running. Retry time is excluded; first request time is retained.

The mode-0600 deliberations.sqlite stores project/source/deliberation coordinates, request hash, principal hash, policy, plaintext topic required for execution, first time, queued/leased/settled/uncertain state, attempts/lease, and validated summary or allowlisted failure. Triggers prohibit deletion, identity mutation, and invalid transitions. It excludes principal text, platform addresses, credentials, and raw provider errors and remains separate from platform, interaction, and body stores.

Transitions are queued to leased to settled or uncertain; only the same owner/lease may heartbeat. A worker leases one job, renews at one-third of the lease, invokes the execution port, and settles only a validated matching summary. Exceptions or heartbeat failure yield deliberation_execution_uncertain.

Expired leases never auto-run again; they become uncertain with worker_lease_expired because external execution cannot be disproved. Queries return unknown. Queue state is not selected/loaded/injected/used or completion evidence. The conversation app composes this only when bindings, execution port, and worker ID exist.

## Consequences

Repeated delivery converges on one job and ID across restarts. Never-started work may continue safely; uncertain external effects require later authoritative reconciliation, not replay.
