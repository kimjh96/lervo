# ADR-0162: Reloadable Hub Cryptographic Material and Service Definitions

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub TLS, policy signers, and command signers were startup snapshots, preventing safe overlapping rotation. Hub and Node also lacked reviewable systemd and launchd definitions.

## Decision

Hub configuration accepts exactly one of legacy inline signing or the recommended `signingFile`. The owner-only v1 snapshot contains policy and command `keyId`/`privateKeyPath` pairs; paths resolve relative to the snapshot.

On SIGHUP, credentials, both signers, and the configured TLS certificate and key are loaded and validated before replacement. Any failure preserves all current material and reports only `runtime_material_reload_failed`.

TLS candidates must form a TLS 1.3 context before `setSecureContext`; replacement affects only new connections. Signer pairs swap atomically. A key ID cannot be reused with different material. Rotation adds the new public key and ID to the Node, swaps Hub signers, and removes old trust only after historical retention. Control HMAC and Hub identity still require restart; ADR-0163 defines Node trust reload.

`pnpm service:render` writes systemd or launchd definitions only to a new, explicit, absolute mode-0600 path. The executable and configuration must already exist, and output is never overwritten. [ADR-0202](../../operations/services/0202-repository-node-fleet-identity-and-registry.md) later requires deterministic repository-node instance IDs for Node definitions while retaining the singleton Hub identity.

Systemd definitions set restart-on-failure, SIGTERM, a 120-second timeout, SIGHUP, `UMask=0077`, and `NoNewPrivileges`. Launchd definitions set argument arrays, failure restart, background operation, and umask. Rendering never loads, enables, or starts services and never writes system directories. Definitions contain executable and configuration paths only, never secret bodies. Reloading and rendering create no event, receipt, or provider state.

## Consequences

Fixtures verify strict external snapshots, permissions, relative paths, new-ID swaps, reused-ID rejection, live TLS reload with invalid-candidate rollback, sanitized SIGHUP failure, service escaping and contracts, and no overwrite.

ACME, CA distribution, system installation, elevation, and multi-host rollout remain outside scope.
