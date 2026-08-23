# ADR-0163: Atomic Node Trust-Material Reload

- Status: accepted
- Decision date: 2026-08-22

## Context

Hub signers became reloadable, but Node trust remained fixed in main config. In-flight verification must never see partial key lists or lose valid trust because a candidate file is bad, and key IDs must never change meaning during a process lifetime.

## Decision

remoteCommands accepts exactly one of inline commandKeys/policyKeys or recommended trustFile. The owner-only v1 snapshot contains both lists and resolves public-key paths relative to itself.

Startup and reload share bounded validation of IDs, Ed25519 keys, policy purposes, and duplicates. Both new stores are completed before stable wrapper references swap. Any observed key ID is permanently bound to one public-key hash for the process, even after removal; changed material requires a new ID.

SIGHUP preloads bearer token and both trust stores. Any failure preserves all three and reports only runtime_material_reload_failed; overlapping reloads share one promise. Each token request and signer lookup retains its selected immutable snapshot through completion.

Safe rotation adds new public keys/IDs alongside old ones, reloads Node, verifies trust, swaps and verifies Hub signers, then removes old keys after signed-source retention.

Trust files are owner-only. Output, events, receipts, and SQLite exclude snapshots, hashes, IDs, token, paths, and causes. Reload proves no connection, policy, command, provider, or content use.

## Consequences

Fixtures cover strict external sources, relative paths, inline exclusivity, new-key verification, removed lookup, same-ID mutation rejection with old verifier survival, coalesced live reload, candidate rollback, and SIGHUP full-material behavior.
