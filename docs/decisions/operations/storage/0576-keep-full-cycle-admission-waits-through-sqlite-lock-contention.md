# ADR-0576: Keep full-cycle admission waits through SQLite lock contention

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0574](../../distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (how the admission wait and release fail)
Amended by: [ADR-0577](../../distribution/0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md) (renewal detects a lost lease)
Related: [ADR-0509](0509-install-the-sqlite-busy-handler-before-any-other-statement.md) (busy handler first), [ADR-0484](../services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) (upgrade exclusion)

## Context

`lervo upgrade --apply` failed twice on the Mac with `ERR_SQLITE_ERROR: database is locked`: in `lervo` during the v0.24.0 rollout, and in `axli-lab` during the v0.24.1 rollout. In `axli-lab`, the command printed the full-cycle admission wait notice and failed 13 minutes later. Its plan was `pending_authority`, so `--safe` should have ended with `upgrade_owner_approval_required`.

The evidence points to `full-cycle-admission.sqlite`. No stack was captured: the CLI reports only the code and message, and the failed apply was not rerun. The `lervo` failure left no receipt, so its cause is inferred from the same path. Other host-wide databases that a full apply opens after admission were not traced; the traced plan-only run does not cover the apply stages.

- A traced plan-only run of `axli-lab` opened one database, the repository's `events.sqlite`. It is in WAL mode, and its writes use `BEGIN IMMEDIATE`. An apply adds only the host's full-cycle admission database.
- Every connection to the admission database already used `openSqliteDatabase` with the 5-second busy wait and `BEGIN IMMEDIATE`. Neither a missing wait nor a deferred read-then-write transaction caused the error.
- The admission database used the rollback journal with `synchronous = FULL`. Every waiter opens a connection about once a second and commits a heartbeat. On the Mac, the host knowledge worker polled for 7 repositories and the `argo` Node worker for one more. A commit holds the file exclusively while it waits for readers and syncs, and blocked connections back off while holding their own locks.
- A read-only probe of the live Mac file over 240 seconds found it exclusively locked 22% of the time. The longest continuous lock lasted 5.17 seconds, beyond the 5-second wait.
- On WSL, 8 processes with 7 waiters each, polling every 20 ms, reproduced the convoy. In rollback-journal mode, the slowest poll took 5,013 ms and 3 polls failed with `database is locked`. In WAL mode with `synchronous = NORMAL`, the slowest of 30,340 polls took 105 ms, and none failed.

The code turned one slow statement into a failed upgrade:

- `tryAcquire` threw, which ended the whole wait, although the wait is itself a poll bounded by the caller's 15-minute deadline.
- `release()` threw. `withKnowledgeResidentExclusion` releases in `finally`, so a failed release replaced the command's own result. For `axli-lab`, it would have replaced `upgrade_owner_approval_required`.
- The admission database helper leaked its connection when `chmod` or a schema statement failed.

## Decision

### The admission database uses WAL

Each connection to `full-cycle-admission.sqlite` runs `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;` after its busy wait and before its schema statements. The first connection from this release converts a database that an earlier release created. The journal mode is stored in the file, so residents from earlier releases then use WAL too.

Readers, including `contended()`, `preempted()`, and schema checks, no longer wait for a writer. A writer holds the lock only for its own short transaction. `synchronous = NORMAL` can lose the last commits on power failure. The rows describe only live processes, which a power failure also ends, so nothing of value is lost.

### Lock contention delays admission instead of failing it

- **Waiting.** A poll that fails with `SQLITE_BUSY` or `SQLITE_LOCKED` counts as not admitted, and the waiter polls again. Abort or the caller's deadline still ends the wait: `knowledge_cancelled` for a resident, `knowledge_cycle_admission_wait_expired` for an upgrade. Other SQLite failures still fail the wait.
- **Releasing.** `release()` retries a contended delete until it succeeds or the lease lapses. A lapsed lease no longer blocks any waiter, so the release then returns. Other SQLite failures still throw. A short-lived caller can shorten the retry with `releaseContentionWaitMilliseconds`. `lervo upgrade --apply` uses 30 seconds, so a stuck writer cannot hold back its receipt for the rest of the lease. If the release gives up, the row stops counting when the upgrade process exits, under the existing dead-holder rule. The resident keeps the lease-bounded retry, because its live process keeps the row held.
- **Naming.** A SQLite failure that leaves the admission module carries the prefix `full-cycle-admission.sqlite: ` in its message and keeps its `code` and `errcode`. The next failure names its database without a stack.
- **Holding.** `contended()`, `preempted()`, and lease renewal keep their behavior: an unreadable database answers false, and a failed renewal waits for the next minute.

`@lervo/sqlite-connection` exports `isSqliteLockContention(error)`. It is true for primary result codes 5 and 6, including extended codes. The supervision process lock, the repository source gate, and the terminal runtime store lock use it instead of their own copies. The first two already masked extended codes. The terminal runtime store lock compared the exact codes 5 and 6, so it now also treats extended codes such as `SQLITE_BUSY_RECOVERY` as a held lock and returns null instead of throwing.

The admission database helper closes its connection when any later setup step fails.

## States, privacy, and failure meaning

No event, column, or state is added. The admission directory gains the SQLite `-wal` and `-shm` files next to the database. SQLite creates them with the database file's `0600` mode, and they hold the same process IDs, nonces, path hashes, and times. The directory is `0700` only when Lervo creates it, because `mkdir` applies the mode only to a new directory.

- `database is locked` from the full-cycle admission no longer ends an upgrade or a resident cycle. A wait still ends only by admission, abort, or deadline.
- A non-contention SQLite failure, such as a corrupt file or a permission error, still fails the wait or the release with its original error.
- If a connection cannot convert the file to WAL because of contention, its poll counts as not admitted, and a later connection converts it.

## Consequences

A host with many residents no longer turns admission polling into upgrade failures. A busy poll still blocks its process for up to the 5-second busy wait before the next poll. The fix covers only the full-cycle admission database. Other host-wide coordination databases, such as provider admission and practice budgets, keep the rollback journal. They are not on the upgrade path.

## Verification

- `full-cycle-admission.test.ts`: another process holds the write lock for 6.5 seconds, past the 5-second busy wait. An upgrade waiting through it is admitted after the lock is released, and a release through it removes the holder row. The holder answers `preempted()` and `contended()` within the busy wait while another process holds `BEGIN EXCLUSIVE`. A rollback-journal database from an earlier release becomes WAL. On origin/main, the first three tests fail: the wait and the release with `database is locked`, and `preempted()` with false.
- `full-cycle-admission.test.ts` also covers the short release wait: it returns while another process still holds the lock and leaves the row for the dead-holder rule. A file that is not a database fails with `ERR_SQLITE_ERROR` and a message that starts with `full-cycle-admission.sqlite: `.
- `sqlite-connection.test.ts`: `isSqliteLockContention` is true for a held lock and false for a missing table or a plain `Error`.
- Existing tests for the source gate, the terminal runtime store, the supervision locks, ADR-0574 priority, the resident loop, upgrade exclusion, and the upgrade command still pass.

Installed verification: after the release that carries this change, run `upgrade-all.sh` on the Mac and on WSL. Record whether any repository upgrade fails with `ERR_SQLITE_ERROR` in the [release-to-fleet roadmap](../../../roadmap/operations/release-to-fleet.md).
