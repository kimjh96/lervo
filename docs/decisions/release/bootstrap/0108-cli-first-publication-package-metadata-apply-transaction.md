# ADR-0108: CLI first-publication package-metadata apply transaction

Status: `accepted`
Decision date: 2026-08-21

## Context

Applying package JSON alone immediately desynchronizes the release manifest and SBOM. Filesystems cannot atomically commit three paths, so the operation must expose interruptions and support deterministic recovery instead of claiming full atomicity.

## Decision

Add `metadata-apply --permit <absolute> --write --json` and a separate `--recover` operation.

Before the first write:

- Rebuild the decision, preview, candidate, output, and permit.
- Snapshot the permit, package, release manifest, SBOM, and lockfile as bounded regular files, then confirm they remain unchanged.
- Generate in memory the exact package candidate, the production release manifest using the package override, and a deterministic SBOM from the new manifest and snapshotted lockfile.
- Validate current sources. The new manifest may differ only in approved metadata and the derived artifact digest; reject unrelated build, dependency, or archive drift.

Plan v1 binds the permit and candidate, before/after counts and hashes for the three writes, and the read-only sources. It requires pre-write CAS, mode-preserving staged replacement, a recovery journal, rollback of every file after synchronous failure, and explicit recovery after interruption.

Use the exclusive, owner-only `apps/cli/.lervo-metadata-apply-transaction` directory. Journal every staging move and publication, and preserve originals. Commit only after all after-digests and read-only sources match, then clean up. On synchronous failure, restore originals in reverse order and verify their before-hashes; if restoration fails, retain the journal with `rollback_failed`.

Never infer rollback after process death. A pending journal blocks new apply operations before source reads and blocks every release/publication flow. Recovery must refuse a live owner and either restore the pre-commit state or preserve verified post-commit files and remove only the journal.

A success receipt binds the plan, permit, candidate, every file binding, cleanup, and regeneration effect. Emit output only on stdout. Modify only the package, release manifest, and SBOM—not the permit, lockfile, approval, or external state. Temporary source material must remain inside the local transaction.

Failures distinguish arguments, source, regeneration, plan, source-changed, apply, recovery-required, busy, not-found, journal, and rollback errors without exposing sensitive bodies, paths, PIDs, or digests.

## Consequences

The three derived files remain consistent after synchronous failures and have deterministic crash recovery. This does not claim instantaneous multi-file atomicity across power loss.
