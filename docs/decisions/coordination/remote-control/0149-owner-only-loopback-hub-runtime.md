# ADR-0149: Owner-Only, Loopback-Restricted Hub Runtime

- Status: accepted
- Decision date: 2026-08-22

> Extended by ADR-0158 for direct TLS and ADR-0159 for bearer-credential reload.

## Context

Hub handlers and durable cleanup existed without a safe executable composition root. Manual assembly could leak stores on startup failure or close them before background work. The entrypoint must not generate secrets or expose plaintext externally, while avoiding commitment to one certificate issuer or supervisor.

## Decision

@lervo/hub-runtime owns lervo-hub --config <config.json>; @lervo/hub stays free of storage paths, signals, and key loading. Runtime reads bounded configuration and Ed25519/HMAC secrets, builds authentication/signing/review, opens and audits owner-only SQLite and command CAS, attaches all handlers plus cleanup, and reports startup only after listen. Temporary secret buffers are zeroed after parsing.

Schema-version-1 JSON is strict, resolves paths relative to itself, and defines loopback host/port, SQLite/CAS, pretrusted Hub identity, 1–256 scoped bearer credentials, policy/command key IDs and private-key files, control HMAC file/TTL, and cleanup worker/bounds. Config, key, HMAC, database directory, and auxiliaries must be owner-only regular files/locations. CAS enforces 0700/0600. Windows applies type and symlink checks where POSIX modes do not apply.

No bearer, key, or identity is generated. Trust distribution, secret backup, encrypted-key prompts, and external secret managers remain deployment concerns. Without ADR-0158 TLS configuration, both parser and direct API allow only 127.0.0.1 or ::1.

SIGINT, SIGTERM, and close converge on one promise: stop accepting HTTP and finish responses, abort cleanup waits and settle bounded work, then close SQLite. Runtime or cleanup failure initiates the same shutdown. Partial startup closes already-open stores.

No new execution event/state is created. Startup output contains only loopback host/port. Fixed public errors are invalid_arguments, invalid_config, unsafe_runtime_file, startup_failed, listen_failed, shutdown_failed, hub_server_runtime_failed, and artifact_cleanup_runtime_failed; causes remain internal.

## Consequences

Fixtures verify relative paths, permission rejection, external plaintext rejection, strict fields/bounds, authenticated live HTTP, ordered SIGTERM shutdown, database reopen/audit, and secret redaction. This is the first safe Hub process entrypoint, not production TLS, secret management, supervision, or service installation.
