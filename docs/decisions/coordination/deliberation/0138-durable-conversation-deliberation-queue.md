# ADR-0138: Durable Conversation Deliberation Queue

- Status: accepted
- Decision date: 2026-08-22

## Context

Running a long deliberation within an interaction lease risks duplicates. A process can also persist project effects and die before committing the queue result; SQLite cannot atomically combine these operations.

## Decision

`@lervo/conversation-control` defines a job-store port, queued backend, one-cycle worker, and provider-neutral execution port. The backend derives a deterministic `dlb_` ID from `projectId` and `sourceEventId`, reserves a request hash over principal, policy, and topic, and immediately returns `running`. Retry time is excluded; the first request time is retained.

The mode-0600 `deliberations.sqlite` stores project, source, and deliberation coordinates; request and principal hashes; policy; the plaintext topic required for execution; first request time; queued, leased, settled, or uncertain state; attempt and lease data; and a validated summary or allowlisted failure. Triggers prohibit deletion, identity mutation, and invalid transitions.

The database excludes principal text, platform addresses, credentials, and raw provider errors. It remains separate from platform, interaction, and body stores.

State moves from `queued` to `leased`, then to `settled` or `uncertain`. Only the matching owner and lease may heartbeat. A worker leases one job, renews at one-third of the lease duration, invokes the execution port, and settles only a validated, matching summary. Exceptions or heartbeat failure produce `deliberation_execution_uncertain`.

Expired leases never run automatically again. They become uncertain with `worker_lease_expired` because external execution cannot be disproved. Queries return `unknown`.

Queue state is neither selected, loaded, injected, or used content nor completion evidence. The conversation app composes the queue only when bindings, an execution port, and a worker ID exist.

## Consequences

Repeated delivery converges on one job and ID across restarts. Work known never to have started may continue safely. Uncertain external effects require authoritative reconciliation, never replay.
