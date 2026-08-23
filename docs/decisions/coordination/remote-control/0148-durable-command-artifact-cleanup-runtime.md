# ADR-0148: Durable Command Artifact Cleanup Runtime

- Status: accepted
- Decision date: 2026-08-22

## Context

ADR-0147 defines one bounded cleanup cycle but not durable scheduling or cursor recovery. Memory-only timers restart scans, multiple Hub processes duplicate work, shutdown can race stores, and one shared URI could have unbounded delivery purges.

## Decision

The cleanup loop composes only CAS inventory/deletion, retention claim/purge, and a schedule store. It runs hourly by default, continues after one second when work remains or objects fail, and retries cycle/schedule failure after one minute using fixed codes. Runtime leases default to five minutes and cap at thirty. Cycles and waits are serial.

Candidate time is fixed at cycle start; claim completion/release and scheduler completion use fresh clock values. Abort prevents new work and waits for any bounded cycle to finish safely.

@lervo/hub-sync-sqlite stores one command_artifact_cleanup singleton with durable cursor, next time, active lease coordinates, cumulative count, last outcome/time, bounded completion counts, continuation, and fixed failure. Initial next time is epoch. BEGIN IMMEDIATE makes one process owner; expired leases resume at the same cursor. Only the unexpired matching owner may update completion or failure. Deletion is prohibited and full audits validate all relationships.

Claims contain no delivery array. Each completion purges at most 100 deliveries. Remaining references produce partial, close the claim, and are reclaimed later; idempotent CAS deletion makes subsequent batches safe. Until final completed, unpurged references stay cleanup_claimed and new authorship conflicts. A cycle has at most 100 claims and 100 purges per claim.

createHubServer remains storage-neutral. Only attachHubArtifactCleanupLifecycle or createHubServerWithArtifactCleanup starts after listening and aborts on close, exposing settled and stop so stores close afterward. One lifecycle attaches per server. Background errors expose only artifact_cleanup_runtime_failed.

Scheduler state stores only safe worker/cursor/times/counts/fixed codes. Its states are not command or content-use evidence. artifact_cleanup_cycle_failed preserves the cursor and schedules retry; runtime failure means even durable failure closure was impossible; conflicts prevent stale owners from overwriting; partial is normal continuation.

## Consequences

Fixtures verify competing workers, lease takeover, restart cursor, retry timing, serial operation, server lifecycle ordering, sanitized failures, fresh completion time, 101 shared deliveries split 100+1, and cleanup_claimed between batches. The runtime is not attached to user CAS by these tests.
