# ADR-0149: Owner-Only, Loopback-Restricted Hub Runtime

- Status: accepted
- Decision date: 2026-08-22

> Extended by ADR-0158 for direct TLS and ADR-0159 for bearer-credential reload.

## Context

Hub handlers and durable cleanup existed without a safe executable composition root. Manual assembly could leak stores on startup failure or close them before background work. The entrypoint must not generate secrets or expose plaintext externally and must avoid committing to a certificate issuer or supervisor.

## Decision

`@lervo/hub-runtime` owns `lervo-hub --config <config.json>`; `@lervo/hub` remains free of storage paths, signals, and key loading. The runtime reads bounded configuration and Ed25519/HMAC secrets; builds authentication, signing, and review; opens and audits owner-only SQLite and command CAS; attaches all handlers and cleanup; and reports startup only after listening. Temporary secret buffers are zeroed after parsing.

Schema-version-1 JSON is strict, resolves paths relative to the configuration file, and defines the loopback host and port; SQLite and CAS; pretrusted Hub identity; 1–256 scoped bearer credentials; policy and command key IDs and private-key files; control HMAC file and TTL; and cleanup worker and bounds. Configuration, key, HMAC, and auxiliary files, plus database directories and other locations, must be owner-only regular files or locations. CAS enforces `0700` directories and `0600` objects. Windows applies type and symlink checks where POSIX modes are unavailable.

No bearer credential, key, or identity is generated. Trust distribution, secret backup, encrypted-key prompts, and external secret managers remain deployment concerns. Without ADR-0158 TLS configuration, both the parser and direct API allow only `127.0.0.1` or `::1`.

`SIGINT`, `SIGTERM`, and close converge on one promise: stop accepting HTTP; allow active responses a fixed 10-second drain; close connections still active at the deadline; abort cleanup waits and settle bounded work; then close SQLite. Runtime or cleanup failure initiates the same shutdown. Partial startup closes stores already opened.

The close result names the HTTP disposition as `graceful` or `forced`. `forced` means only that connections remained at the drain deadline. It interrupts those connections, emits one fixed secret-free warning, and still exits successfully after cleanup and SQLite close. It is not reported as `shutdown_failed`, because the bounded close contract completed. The disposition contains no peer address, request path, request body, credential, or other connection detail and is not persisted as an event or durable state.

No execution event or persistent state is added. Startup output contains only the loopback host and port. Fixed public errors are `invalid_arguments`, `invalid_config`, `unsafe_runtime_file`, `startup_failed`, `listen_failed`, `shutdown_failed`, `hub_server_runtime_failed`, and `artifact_cleanup_runtime_failed`; causes remain internal.

## Consequences

Fixtures verify relative paths, permission rejection, external plaintext rejection, strict fields and bounds, authenticated live HTTP, graceful and deadline-forced connection drain, ordered `SIGTERM` shutdown, database reopen and audit, and secret redaction. This is the first safe Hub process entrypoint, not production TLS, secret management, supervision, or service installation.
