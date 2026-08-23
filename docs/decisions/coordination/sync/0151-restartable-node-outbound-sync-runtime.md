# ADR-0151: Restartable Node Outbound-Sync Runtime

- Status: accepted
- Decision date: 2026-08-22

## Context

A single sync cycle existed, but users had to assemble and repeat it manually, and process/store shutdown ordering was undefined. Synchronization must remain outside local CLI execution and cannot create competing event truth.

## Decision

`@lervo/sync` adds `runOutboundSyncLoop`. Cycles never overlap: a synchronized result continues immediately, idle waits a bounded interval, and deferred registrations or batches wait until the worker's `nextAttemptAt`. Abort starts no new cycle. Callbacks execute inside the same serial boundary.

`@lervo/node-runtime` provides `lervo-node --config <config.json>` for one project. Strict JSON specifies the repository root, HTTPS Hub URL, separate bearer-token file, destination and Hub identity, and bounded worker, polling, and HTTP settings. Relative paths resolve from the configuration file. Configuration and token must be owner-only regular files. The token is 32–4096 visible ASCII characters with at most one trailing newline. Shared low-level checks live in `@lervo/runtime-security`.

The runtime verifies the repository and manifest and opens the project-bound event store only when `hubSyncEnabled=true`. Manifest identity, destination, Hub identity, and token are frozen into the transport; configuration is a startup snapshot, not partially hot-reloaded.

After authenticated registration, every cycle reconciles a bounded local prefix following the Hub cursor into that destination's durable outbox before claiming leases, as defined by [ADR-0194](0194-destination-bound-local-event-reconciliation.md).

`SIGINT`, `SIGTERM`, and `close` converge: abort waiting and future cycles, finish the bounded in-flight HTTP cycle, then close SQLite. Repeated `close` returns the same result. Offline conditions and timeouts remain deferred worker results. Only unrecoverable worker, store, or callback errors close with `sync_runtime_failed`.

Add no event, scheduler database, or execution state. Memory-only cycle diagnostics are not restart truth; the local event chain, Hub cursor, and durable outbox remain authoritative for reconciliation and delivery. Diagnostics may expose only bounded counts such as `enqueuedCount`.

Output omits repository, URL, identities, tokens, payloads, and internals and uses fixed configuration, project, runtime, and shutdown errors. Startup and registration prove neither event delivery nor content use. The local CLI still completes without Hub or Node.

## Consequences

Fixtures verify owner-only security, Hub-runtime regressions, offline shutdown, restart against a real Hub with one event on each side, local acknowledgement, and signal redaction. This runtime owns outbound synchronization only; remote control, multi-project hosting, hot reload, service installation, and production TLS lifecycle remain separate.
