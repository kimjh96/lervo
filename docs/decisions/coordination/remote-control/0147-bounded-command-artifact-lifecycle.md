# ADR-0147: Bounded, Race-Safe Command Artifact Lifecycle

- Status: accepted
- Decision date: 2026-08-22

> [ADR-0148](0148-durable-command-artifact-cleanup-runtime.md) adds a durable cursor, singleton scheduler, Hub lifecycle binding, and a 100-delivery purge bound per claim.

## Context

Command CAS lacked physical cleanup. Pre-commit crashes leave orphans, shared content addresses prevent deletion based on one command, and authoring may race with cleanup or stop between CAS deletion and SQLite completion.

## Decision

OwnerOnlyFileSystemCas provides ordered inventory and idempotent deletion only. Inventory returns 100 by default, at most 1,000, scanning 100,000 by default and at most 1,000,000 objects. Cursors are last CAS URIs; object hash, type, and content are revalidated. Unsafe entries and capacity overflow fail without partial success.

The application combines physical CAS and lifecycle repository ports without knowing SQLite, paths, scheduler, or provider. One cycle handles at most 100 expired references and inventory candidates.

Each authorship has artifactRetainUntil, at least command expiry and at most 30 days; default is 30 days. An expired claim requires every unpurged reference for the URI to be past both retention and command expiry. Authorship, retention, purge, and completion are append-only. Only claims are leased mutable state. Active claims block new authorship.

Lookups distinguish retained, cleanup_claimed, and purged. Duplicate submissions under cleanup or after purge return the original envelope and never recreate expired bytes. To bridge non-atomic CAS/SQLite writes, authoring verifies before commit and puts/verifies again after commit. Cleanup cannot leave a successful new authorship pointing only to missing bytes.

Cleanup orders SQLite claim, idempotent CAS delete, then transactional condition recheck plus purge/completion. Interruption after deletion resumes safely with deleted=false. Duplicate completion is idempotent. Failures release claims where possible and record only counts.

Inventory objects with no unpurged reference and older than a default 24-hour grace may receive orphan claims. A new authorship after claim blocks completion. The grace is configurable only upward within bounds.

SQLite stores no request text, secret, or internal exception. Lifecycle states are operational, not runtime events or execution/content-use evidence. Failures distinguish cleanup conflicts, capacity overflow, unsafe/corrupt CAS, and physical deletion failure.

## Consequences

Fixtures cover cursor stability, limits, shared retention, crash recovery, duplicate completion, missing objects, post-cleanup reauthoring, orphan grace, authoring races, failure recovery, append-only integrity, and owner-only temporary CAS. Scheduler execution remains separate.
