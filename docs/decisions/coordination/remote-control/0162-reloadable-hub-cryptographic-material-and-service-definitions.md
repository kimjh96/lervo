# ADR-0162: Reloadable Hub Cryptographic Material and Service Definitions

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub TLS and active policy/command signers were startup snapshots. Safe overlap required reloadable signer pairs, while Hub and Node also lacked reviewable systemd/launchd definitions.

## Decision

Hub config accepts exactly one of legacy inline signing or recommended signingFile. The owner-only v1 snapshot contains policy and command keyId/privateKeyPath pairs resolved relative to itself.

SIGHUP first loads and validates credentials, both signers, and configured TLS certificate/key. Any failure preserves all current material and reports only runtime_material_reload_failed. TLS candidates must form a TLS-1.3 context before setSecureContext; only new connections use it. Signer pairs swap atomically. Reusing a key ID with different material is forbidden. Rotation adds new public key/ID to Node first, swaps Hub signers, and removes old trust only after historical retention.

Control HMAC and Hub identity still require restart. ADR-0163 handles Node trust reload.

pnpm service:render writes systemd or launchd definitions only to a new explicit absolute mode-0600 path. Existing executable/config are required and output is never overwritten. Systemd fixes restart-on-failure, SIGTERM, 120-second timeout, SIGHUP, UMask=0077, and NoNewPrivileges. Launchd fixes argument arrays, failure restart, background operation, and umask. It never loads, enables, starts, or writes system directories.

Definitions contain only executable/config paths, never secret bodies. Reload/render creates no event, receipt, or provider state.

## Consequences

Fixtures verify strict external snapshots, permissions and relative paths, new-ID swap and reused-ID rejection, live TLS reload with invalid-candidate rollback, sanitized SIGHUP failure, service escaping/contracts, and no overwrite. ACME, CA distribution, system installation, elevation, and multi-host rollout remain outside scope.
