# ADR-0151: Restartable Node Outbound-Sync Runtime

- Status: accepted
- Decision date: 2026-08-22

## Context

One sync cycle worked, but users had to assemble and repeat it manually, and process/store shutdown ordering was undefined. Sync must stay outside local CLI execution and must not create competing event truth.

## Decision

@lervo/sync adds runOutboundSyncLoop. Cycles never overlap: synchronized immediately continues, idle waits a bounded interval, and deferred registration/batches wait until worker nextAttemptAt. Abort starts no new cycle. Callbacks run inside the same serial boundary.

@lervo/node-runtime provides lervo-node --config <config.json> for one project. Strict JSON contains repository root, HTTPS Hub URL, a separate bearer-token file, destination/Hub identity, and bounded worker/poll/HTTP settings; relative paths resolve from config. Config and token are owner-only regular files. Token is 32–4096 visible ASCII characters with at most one final newline. Shared low-level checks live in @lervo/runtime-security.

Runtime verifies the repository and manifest and opens the project-bound event store only when hubSyncEnabled=true. Manifest identity, destination, Hub identity, and token are frozen into transport; config is a startup snapshot, not partially hot-reloaded. After authenticated registration, each cycle reconciles a bounded local prefix after the Hub cursor into that destination's durable outbox before claiming leases (ADR-0194).

SIGINT, SIGTERM, and close converge: abort waits and future cycles, finish the bounded in-flight HTTP cycle, then close SQLite. Repeated close returns the same result. Offline/timeouts remain deferred worker results; only unrecoverable worker/store/callback errors close sync_runtime_failed.

No event, scheduler DB, or new execution state is added. Memory-only cycle diagnostics are not restart truth; the local event chain, Hub cursor, and durable outbox remain authoritative for reconciliation and delivery. Cycle diagnostics may report only bounded counts such as `enqueuedCount`. Output omits repository, URL, identities, tokens, payloads, and internals and uses fixed configuration/project/runtime/shutdown errors. Startup and registration prove neither event delivery nor content use. Local CLI still completes without Hub or Node.

## Consequences

Fixtures verify owner-only security, Hub-runtime regressions, offline shutdown, restart against a real Hub with one event on each side, local acknowledgement, and signal redaction. This runtime owns outbound sync only; remote control, multi-project hosting, hot reload, service installation, and production TLS lifecycle remain separate.
