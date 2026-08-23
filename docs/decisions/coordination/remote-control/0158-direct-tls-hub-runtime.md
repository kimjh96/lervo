# ADR-0158: Direct TLS Termination in the Hub Runtime

- Status: accepted
- Decision date: 2026-08-22

## Context

`lervo-hub` was limited to plaintext loopback connections, while production Node transports require HTTPS. A reverse proxy remained possible, but Lervo could not directly connect remote devices.

## Decision

Optional Hub `tls` configuration requires both `certificatePath` and `privateKeyPath`, resolved relative to the config file. Each must be an owner-only regular file no larger than 64 KiB. The runtime reads each file once to create HTTPS, then zeroes the temporary buffers.

Direct TLS permits only TLS 1.3 or newer. Standard clients validate the certificate chain, hostname, and roots. The Hub identity header and bearer scope remain additional checks.

Without `tls`, plaintext binding is restricted to `127.0.0.1` or `::1`. An external bind is accepted only when both TLS files are valid.

HTTP and HTTPS use one transport-neutral request listener with identical authentication, body limits, storage, cleanup, and server-to-cleanup-to-store shutdown behavior. TLS material initially required restart; ADR-0162 later adds validated secure-context reload. ACME, CA distribution, secret managers, and mTLS remain separate concerns.

Invalid TLS/host relationships fail with `invalid_config` before network or storage initialization. Unsafe files fail with `unsafe_runtime_file`; parsing or context creation fails with `startup_failed`. Output reveals no certificate, key, path, identity, or credential.

Successful TLS startup proves no command, sync, or content use and adds no event or runtime ledger.

## Consequences

Fixtures reject plaintext external binding and partial TLS configuration, resolve owner-only paths, and negotiate TLS 1.3 with an explicitly trusted SAN certificate on a real authenticated route. They also preserve loopback, signal, cleanup, reopen, and handler regressions.
