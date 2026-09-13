# ADR-0399: Change-driven repository and conversation work

Status: accepted
Date: 2026-09-11

## Decision

Extend ADR-0397's separation of advisory notifications from durable verification to repository replicas, conversation queues, and the explicit unattended scheduler. Idle timers provide recovery, not normal work discovery. Transport heartbeats, lease renewal, retry deadlines, execution timeouts, and integrity audits remain required timers.

Repository reconciliation subscribes to bounded local filesystem watches and a persistent SSH change stream per configured peer repository. Notifications coalesce in a 250 ms batch. Only notified repositories reconcile; a 60-second recovery pass rechecks all configured repositories. Missing watchers or unsupported peers retain configured polling fallback. Reconnection starts with a hint and fresh reconciliation. Notifications never grant source authority, bypass divergence, or replace exact snapshot checks.

Snapshot observation builds exact Git tree coordinates without creating export commits or updating export refs. Bundling materializes the export commit. Explicitly authorized history replacement separately materializes its exact predecessor before creating the recovery ref, so recovery does not depend on a ref from earlier observation.

A native-work readiness request writes one replaceable, owner-only advisory request with a schema version and random nonce. Repository watchers observe it even though runtime state is excluded from replicated source. The coordinator verifies parity and publishes its existing receipt. Readiness watches receipt replacement, captures the exact worktree before admission, and avoids repeated captures against the same mismatching receipt. Missing notification support retains bounded recovery and the original work deadline.

Conversation queues notify through SQLite directory/WAL changes. The application exposes advisory next-work and lease-expiry timestamps from their owning stores. Serial workers wake on changes, the nearest relevant deadline, or a 30-second recovery pass. Current policy and role bindings filter interaction inbox deadlines. Pending uncertain-result reconciliation retains its bounded retry deadline. The explicit unattended scheduler also wakes on event-database and kill-switch changes; failure backoff and all execution budgets remain authoritative.

Workstream audits use a stable repository-path-derived interval of 45–60 seconds. Neither the maximum interval nor the healthy-idle 85-second-plus-in-flight integrity detection bound increases. Startup still validates fully. Identical health observations within one second do not replace the health file; any component or aggregate-state change is published immediately. This suppresses duplicate writes without fabricating a newer durable observation timestamp.

## Contracts and verification

The [change-driven work specification](../../../specifications/coordination/node-change-driven-work.md) owns transient-state fields, bounds, recovery, and the polling inventory. No new canonical execution event, authority token, external service, or runtime dependency is introduced. Regression and installed-artifact evidence must distinguish source behavior, transport notification, runtime readiness, and measured savings.
