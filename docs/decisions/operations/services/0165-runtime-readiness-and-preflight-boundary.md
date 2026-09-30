# ADR-0165: Runtime Readiness Separate from OS Activation

- Status: accepted
- Decision date: 2026-08-22

## Context

An active service process does not prove Hub storage or Node synchronization and control readiness. Readiness must expose neither secrets nor source coordinates, avoid a full audit on every request, and add no inbound Node port.

## Decision

Hub exposes unauthenticated `GET /v1/health/live`, `GET /v1/health/ready`, and `GET /v1/health/capabilities` with `x-lervo-hub-identity`. Live and ready responses contain only `schemaVersion` and fixed status or bounded failure. Capabilities returns the provider-neutral, secret-free event-reader capability report without checking storage. Other methods, queries, and paths fail.

Liveness proves only listener response and does not read the store. Readiness runs bounded SQLite and cleanup `checkIntegrity`, never full `auditIntegrity`. Success is `200 ready`; failure is `503 not_ready` with `storage_unavailable` and no internal counts.

Node atomically writes owner-only `.lervo/state/node-runtime-health.json` containing schema, status, PID, start and update times, additive event-reader capability report, and component state. The capability report neither affects readiness nor authorizes event writing. Older v1 snapshots without it remain readable.

Distribution preflight accepts the Node's optional supervision projection, including bounded unavailable reason codes and exact dormant `workstream_inactive` state. Ready aggregate health may include ready, disabled, or dormant supervision; unavailable supervision remains degraded. Unknown fields, reasons, or component states fail closed.

Overall status is `starting`, `ready`, `degraded`, or `stopping`. Required components move from `pending` to `ready` or bounded `unavailable`; disabled optional components are acceptable. Overall readiness requires every required component to be ready or disabled.

Failure to publish initially or after a cycle is a runtime failure. Shutdown attempts best-effort `stopping` publication before normal store closure.

`pnpm runtime:preflight` reads one Hub or Node:

- Hub checks HTTPS root, expected identity, optional CA, a five-second default timeout with a 300-second maximum, and a 4 KiB response limit. HTTP is allowed only on loopback.
- Node checks an explicit safe snapshot and live PID; stale files are not ready.

Preflight returns only `ready` or `not_ready` with fixed errors. It never installs, starts, restarts, reads credentials, or creates evidence.

Output omits URLs, paths, PID, identity, component codes, raw HTTP, and causes. Health snapshots are local operational state, not evidence of execution, acknowledgement, provider activity, or loaded, injected, or used content.

## Consequences

Fixtures verify liveness without storage, bounded readiness, no-store and identity headers, Node state transitions, owner-only schema and live PID, peer and response failures, and existing runtime, pilot, and documentation regressions. Operational readiness requires both an active service and ready preflight result.
