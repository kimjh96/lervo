# Authenticated live triggers

## Scope and ownership

An authenticated live trigger converts one exact external webhook event into one bounded assignment-routine invocation. It creates governed assignments only: it does not claim, execute, schedule, approve, or retry provider work. It operates locally without a Hub.

`@lervo/live-trigger-contract` owns provider-neutral descriptors, authorizations, observations, admission plans, and reservation evidence. `@lervo/adapter-webhook` owns HMAC-SHA256 authentication and loopback HTTP transport. `@lervo/live-trigger-sqlite` owns atomic replay reservation, cumulative authorization budgets, recovery state, and bounded retention. The CLI composes these ports with the existing assignment-routine materializer. Provider adapters and workforce state do not depend on webhook semantics.

## Owner authorization

The owner-only authorization file binds the exact adapter ID and version, project and active workstream, source and credential IDs, accepted event types, validity interval, cumulative maximum accepted triggers, and fixed assignment-routine template. Its lifetime cannot exceed 366 days; its trigger budget cannot exceed 100,000. External request content cannot alter the template, role, paths, criteria, approvals, or verification suites.

The owner-only server config selects a loopback address, bounded path and port, authorization file inside the repository, credential environment-variable name, body limit, clock-skew limit, and concurrency limit. Secrets remain runtime-only. Startup fails if adapter, credential, or secret coordinates are unavailable or inconsistent.

Configuration shape:

```json
{
  "schemaVersion": 1,
  "repositoryRoot": ".",
  "authorizationFile": ".lervo/live-webhook-authorization.json",
  "listen": { "host": "127.0.0.1", "port": 8077, "path": "/hooks/issues" },
  "credential": {
    "credentialId": "issues.webhook",
    "secretEnvironmentVariable": "LERVO_ISSUES_WEBHOOK_SECRET"
  },
  "maximumBodyBytes": 65536,
  "maximumClockSkewMs": 300000,
  "maximumConcurrentRequests": 16
}
```

The authorization is a direct `.lervo/*.json` child containing `schemaVersion`, `kind=lervo_live_webhook_authorization`, exact adapter/project/workstream/source/credential coordinates, `acceptedEventTypes`, `validFrom`, `expiresAt`, `maximumAcceptedTriggers`, and the complete routine template. Both files must be regular owner-only files; use mode `0600` on POSIX systems.

## Authentication and admission

The installed `lervo.webhook.hmac-sha256@1.0.0` adapter accepts only `POST`. It signs the exact bytes `timestamp.event-id.event-type.body` with HMAC-SHA256. Required headers are:

- `x-lervo-timestamp`: ten-digit epoch seconds.
- `x-lervo-event-id`.
- `x-lervo-event-type`.
- `x-lervo-signature`: `v1=<lowercase SHA-256 hex>`.

Requests outside the configured clock-skew window fail closed. The adapter clears loaded secret bytes after verification.

Admission separately verifies adapter, project, current active workstream, source, credential, event type, and authorization time. Successful admission derives an `authenticated_live` routine trigger in process. The public `routine materialize` command rejects this trigger kind: JSON input alone is not authentication authority.

## Idempotency, budget, and recovery

Source ID and native event ID form a one-way source-event-key hash. Exact signing input produces stable authentication evidence, so network replay returns the stored completion without creating another invocation. Reusing a source event key with changed signed input or authorization fails as an idempotency conflict.

SQLite reserves the source event key under `BEGIN IMMEDIATE` before assignment effects and increments a monotonic authorization-usage counter in the same transaction. Completion-record pruning never decrements this counter or restores spent authority. Concurrent replay of an unfinished reservation reports `trigger_in_progress`.

An error after reservation changes the record to `recovery_required`; exact replay may then converge through deterministic assignment IDs. Process loss can leave `reserved` evidence uncertain. Only the explicit bounded `trigger webhook recover --before` operation marks sufficiently old reservations recoverable. It never guesses that an active effect stopped. Only completed records are eligible for bounded pruning. Storage capacity and authorization-budget exhaustion reject before assignment mutation.

## State, privacy, and failure meaning

Private SQLite states are `reserved`, `recovery_required`, and `completed`. A completed record contains the plan, invocation, disposition, assignment IDs, and completion time. Records contain only opaque IDs, hashes, bounded statuses, and timestamps. Raw bodies, native event IDs, signatures, secrets, repository paths, prompts, criteria, provider output, and unrestricted errors are never stored or returned.

No new canonical event type is introduced. Existing `assignment.created` events carry authenticated-live routine provenance through the provider-neutral trigger kind and digest. `202 accepted` proves durable assignment materialization and completion evidence. `200 current` proves an exact replay. All authentication, authority, conflict, budget, capacity, active-work, or uncertain-effect outcomes are explicit failures and grant no provider-execution authority.

## Operations

```bash
lervo trigger webhook serve --config .lervo/live-webhook-server.json --json
lervo trigger webhook recover --config .lervo/live-webhook-server.json --before 2026-09-07T00:00:00Z --json
lervo trigger webhook prune --config .lervo/live-webhook-server.json --before 2026-08-01T00:00:00Z --json
```

`--once` serves one request for controlled automation and acceptance testing. Long-running service supervision, unattended scheduling, automatic claims, and dynamic execution topology remain separate outcomes.

## References

- [Assignment routines](../assignment-routines.md)
- [Adverse-condition safety](../adverse-condition-safety.md)
- [ADR-0378](../../../decisions/execution/orchestration/0378-install-authenticated-live-webhook-triggers.md)
