# ADR-0162: Reloadable Hub Cryptographic Material and Service Definitions

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub TLS and active policy and command signers were startup snapshots. Safe rotation overlap required reloadable signer pairs. The Hub and Node also lacked reviewable systemd and launchd definitions.

## Decision

Hub config accepts exactly one of legacy inline signing or the recommended `signingFile`. The owner-only v1 snapshot contains policy and command `keyId`/`privateKeyPath` pairs whose paths resolve relative to the snapshot.

SIGHUP first loads and validates credentials, both signers, and the configured TLS certificate and key. Any failure preserves all current material and reports only `runtime_material_reload_failed`.

TLS candidates must form a TLS 1.3 context before `setSecureContext`; only new connections use the replacement. Signer pairs swap atomically. Reusing a key ID with different material is forbidden. Rotation requires adding the new public key and ID to the Node, swapping Hub signers, and removing old trust only after historical retention.

Control HMAC and Hub identity still require restart. ADR-0163 defines Node trust reload.

`pnpm service:render` writes systemd or launchd definitions only to a new, explicit, absolute mode-0600 path. The executable and config must already exist, and output is never overwritten.

Systemd definitions fix restart-on-failure, SIGTERM, a 120-second timeout, SIGHUP, `UMask=0077`, and `NoNewPrivileges`. Launchd definitions fix argument arrays, failure restart, background operation, and umask. Rendering never loads, enables, or starts a service and never writes system directories.

Definitions contain only executable and config paths, never secret bodies. Reloading and rendering create no event, receipt, or provider state.

## Consequences

Fixtures verify strict external snapshots, permissions and relative paths, new-ID swaps, reused-ID rejection, live TLS reload with invalid-candidate rollback, sanitized SIGHUP failure, service escaping and contracts, and no overwrite.

ACME, CA distribution, system installation, elevation, and multi-host rollout remain outside scope.
