# ADR-0163: Atomic Node Trust-Material Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub signers became reloadable, but Node trust remained fixed in the main configuration. In-flight verification must never observe partial key lists or lose valid trust because a candidate file is invalid. A key ID must not change meaning during a process lifetime.

## Decision

`remoteCommands` accepts exactly one trust source: inline `commandKeys` and `policyKeys`, or the recommended `trustFile`. The owner-only v1 snapshot contains both lists and resolves public-key paths relative to the snapshot.

Startup and reload use the same bounded validation for IDs, Ed25519 keys, policy purposes, and duplicates. Both new stores must be complete before the stable wrapper references swap. Every observed key ID remains permanently bound to one public-key hash for the process, including after removal; changed key material requires a new ID.

`SIGHUP` preloads the bearer token and both trust stores. Any failure preserves all three current values and reports only `runtime_material_reload_failed`. Overlapping reloads share one promise. Each token request and signer lookup retains its selected immutable snapshot until completion.

Safe rotation proceeds as follows:

1. Add new public keys and IDs alongside the old ones.
2. Reload Node and verify trust.
3. Swap and verify Hub signers.
4. Remove old keys after signed-source retention.

Trust files are owner-only. Output, events, receipts, and SQLite exclude snapshots, hashes, IDs, tokens, paths, and causes. Reload does not prove connection, policy, command, provider, or content use.

## Consequences

Fixtures cover strict external sources, relative paths, inline exclusivity, new-key verification, removed lookup, same-ID mutation rejection with survival of the old verifier, coalesced live reload, candidate rollback, and full-material `SIGHUP` behavior.
