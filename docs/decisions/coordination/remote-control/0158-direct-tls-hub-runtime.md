# ADR-0158: Direct TLS Termination in the Hub Runtime

- Status: accepted
- Decision date: 2026-08-22

## Context

lervo-hub was plaintext loopback-only while production Node transports require HTTPS. A reverse proxy remained possible, but Lervo itself could not connect remote devices vertically.

## Decision

Optional Hub tls requires both certificatePath and privateKeyPath, resolved relative to config. Each is an owner-only regular file up to 64 KiB. Runtime reads them once to create HTTPS and then zeroes temporary buffers.

Direct TLS permits only TLS 1.3+. Standard clients validate chain, hostname, and roots; Hub identity header and bearer scope remain additional checks. Without tls, only plaintext 127.0.0.1 or ::1 is allowed. External bind is accepted only with both valid files.

HTTP and HTTPS share one transport-neutral request listener and identical authentication, body limits, storage, cleanup, and server-to-cleanup-to-store shutdown. At this decision, material changes required restart; ADR-0162 later adds validated secure-context reload. ACME, CA distribution, secret managers, and mTLS remain separate.

Invalid TLS/host relationships fail invalid_config before network/storage; unsafe files fail unsafe_runtime_file; parse/context failures fail startup_failed. Output reveals no certificate, key, path, identity, or credential. TLS success proves no command, sync, or content use and adds no event/runtime ledger.

## Consequences

Fixtures reject plaintext external and partial TLS config, resolve owner-only paths, negotiate TLS 1.3 with an explicitly trusted SAN certificate on a real authenticated route, and preserve loopback, signal, cleanup, reopen, and handler regressions.
