# ADR-0165: Runtime Readiness Separate from OS Activation

- Status: accepted
- Decision date: 2026-08-22

## Context

An active service process does not prove Hub storage or Node sync/control is ready. Readiness must expose no secret/source coordinates, avoid full audits per request, and add no Node inbound port.

## Decision

Hub exposes unauthenticated GET /v1/health/live and /ready with only schemaVersion, fixed status, and x-lervo-hub-identity. Other methods, queries, and paths fail. Live proves only listener response and reads no store. Ready runs bounded SQLite/cleanup checkIntegrity, never full auditIntegrity. Success is 200 ready; failure is 503 not_ready with storage_unavailable and no internal counts.

Node atomically writes owner-only .lervo/state/node-runtime-health.json containing only schema, status, PID, start/update times, sync, and remoteControl. Overall state is starting, ready, degraded, or stopping. Sync and optional control move from pending to ready or bounded unavailable; disabled control is acceptable. Overall ready requires every required component ready or disabled. Initial or post-cycle publication failure is runtime failure; shutdown best-effort publishes stopping before normal store closure.

pnpm runtime:preflight reads one Hub or Node. Hub checks HTTPS root, expected identity, optional CA, a five-second default/300-second maximum timeout, and 4 KiB response; HTTP is loopback-only. Node checks an explicit safe snapshot and live PID so stale files are not ready. It returns only ready/not_ready with fixed errors and never installs, starts, restarts, reads credentials, or creates evidence.

Output omits URLs, paths, PID, identity, component codes, raw HTTP, and causes. Health snapshots are local operational state, not execution, acknowledgement, provider, or loaded/injected/used evidence.

## Consequences

Fixtures verify liveness without storage, bounded readiness, no-store/identity headers, Node state transitions, owner-only schema and live PID, peer/response failures, and existing runtime/pilot/docs regressions. Operational readiness now requires both service active and preflight ready.
