# ADR-0144: Explicit Project-Identity Migration with Source Preservation

- Status: accepted
- Decision date: 2026-08-22

## Context

After adoption of the Lervo identity, initialization safely stopped on legacy `.roven` state but provided no verified migration. Renaming alone cannot validate event hashes, CAS addresses, or old document markers. Global replacement would corrupt append-only sources and user prose.

## Decision

`@lervo/identity-migration` and `lervo migrate identity` own the transition. The default command creates a read-only plan; applying it requires explicitly repeating its plan ID. The plan binds the complete source-tree hash, project, event chain, CAS objects, document-metadata disposition, and destination, and is recomputed immediately before application.

Event DB validation uses a temporary copy and rejects WAL, SHM, or journal files and databases requiring schema migration. Every event-chain coordinate/hash and CAS address/content hash is verified. Automation is blocked by more than 100,000 files, 64 GiB total, 100,000 CAS objects, symlinks, or special files.

Current metadata remains byte-identical and active. Known legacy markers and ownership data are archived byte-for-byte under `.lervo/archive/identity/<sourceDigest>/` without changing user Markdown. The active registry starts empty; later reintroduction uses document migration. Unknown metadata blocks planning.

Application atomically renames the root, creates missing current directories, and appends `project.identity.migrated` to the existing event head. A pre-commit failure removes new paths and SQLite auxiliaries and restores the old root. Unverified recovery is `finalization_failed`. Post-commit history is never deleted.

The event contains only plan ID, source-tree hash, preserved event count/head, verified CAS count, metadata disposition, and apply time. It excludes paths, inventories, bodies, identities, provider data, and credentials. Failed attempts emit no event.

## Consequences

Migration works without Hub, preserves event and CAS bytes, archives legacy metadata without representing it as current-contract data, and fails explicitly for active, large, corrupt, or unknown state. Fixtures cover deterministic planning, clean DB inspection, preservation, races, dual roots, corrupt CAS, archive fidelity, and an empty active registry.
