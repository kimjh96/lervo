# ADR-0165: Runtime Readiness Separate from OS Activation

- Status: accepted
- Decision date: 2026-08-22

## Context

An active service process does not prove that Hub storage or Node synchronization and control are ready. Readiness must expose no secret or source coordinates, avoid a full audit on every request, and add no inbound Node port.

## Decision

Hub exposes unauthenticated `GET /v1/health/live` and `GET /v1/health/ready` endpoints containing only `schemaVersion`, a fixed status, and `x-lervo-hub-identity`. Other methods, queries, and paths fail.

Liveness proves only that the listener responds and does not read the store. Readiness runs bounded SQLite and cleanup `checkIntegrity`, never full `auditIntegrity`. Success is `200 ready`; failure is `503 not_ready` with `storage_unavailable` and no internal counts.

Node atomically writes owner-only `.lervo/state/node-runtime-health.json`. It contains only schema, status, PID, start and update times, sync, and remote-control state. Overall status is `starting`, `ready`, `degraded`, or `stopping`. Sync and optional control move from `pending` to `ready` or bounded `unavailable`; disabled control is acceptable. Overall readiness requires every required component to be ready or disabled.

Failure to publish initially or after a cycle is a runtime failure. Shutdown makes a best-effort publication of `stopping` before normal store closure.

`pnpm runtime:preflight` reads one Hub or Node:

- Hub checks the HTTPS root, expected identity, optional CA, a five-second default timeout with a 300-second maximum, and a 4 KiB response limit. HTTP is allowed only on loopback.
- Node checks an explicit safe snapshot and a live PID, so stale files are not ready.

Preflight returns only `ready` or `not_ready` with fixed errors. It never installs, starts, restarts, reads credentials, or creates evidence.

Output omits URLs, paths, PID, identity, component codes, raw HTTP, and causes. Health snapshots are local operational state, not evidence of execution, acknowledgement, provider activity, or loaded, injected, or used content.

## Consequences

Fixtures verify liveness without storage, bounded readiness, no-store and identity headers, Node state transitions, owner-only schema and live PID, peer and response failures, and existing runtime, pilot, and documentation regressions. Operational readiness now requires both an active service and a ready preflight result.
