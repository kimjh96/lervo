# ADR-0585: Release mirrored backups and settled assignment inputs

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md) (reference roots), [ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) (implements its two proposals)

## Context

[ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) let the collector finish a pass, but it left the policy unchanged. It proposed two changes, and on 2026-11-18 the owner approved both as recommended:

1. Evaluate an event-writer backup through the canonical policy when it mirrors the canonical log.
2. Keep a stage input named by `assignment.created` only while its obligation is open, or while the input belongs to the latest settled stage.

The owner also asked for a read-only estimate before any release deletes data.

## Decision

The candidates, the 14-day grace period, the 32-object deletion cap, the 24-hour wait, the event-head and inventory fences, and the fail-closed reads of ADR-0534 and ADR-0584 do not change.

### Event-writer backups

A backup database is `<data>/event-writer-backups/<name>/events.sqlite`. Its `events` rows are compared with the canonical log one at a time. A row is mirrored only when all of the following hold:

- The live event with the same `event_id` exists.
- That event lies within the replayed snapshot.
- The row has exactly the canonical thirteen columns.
- Its sequence, event hash, previous hash, project, run, session, type, time, schema version and policy version are equal to the live event's.
- Its actor and payload are equal to the live event's after JSON parsing.

A mirrored row names nothing that the canonical replay does not already evaluate, so its references are not roots. Any other row keeps every reference it names. This covers a row that differs from the live event, is missing from the live log, lies beyond the head, or fails to read or parse. The backup's other tables are still scanned as ordinary reference cells. This change verifies, row by row, the property that ADR-0584 observed on the Mac: every backup event has the same hash as the canonical event at the same sequence.

### Settled assignment inputs

When `assignment.created` carries `convergenceObligationId` and a valid `convergenceInputArtifactHash`, that input joins its obligation's stage references:

- While the obligation is open, the input is a root.
- After settlement, only the latest settled stage roots it.
- An input named after its obligation has already settled stays a root.

The event's other payload references remain roots. When an `assignment.convergence.archived` event names the creating event's assignment and obligation, the archive object does not root that input. The archive still roots every other hash it names. A candidate's grace period runs from the latest event that names it, including `assignment.created`.

Every other record that names an input still roots it. These include live workforce records, stage results, provider stage observations, failure proofs and effect checkpoints.

### Readers of a pruned input

A source audit found only one production path that reads an archived assignment's input bytes after settlement: `canonical-disposition-ledger.ts`. It reads current `canonical_integration` stage inputs and results across all obligations. No reader opens an archive body.

The ledger now reads through `readConvergenceStageArtifact`, which returns one of three states:

- `available`;
- `input_unavailable`: the CAS object is absent, normally because retention pruned it;
- `invalid`: the bytes are present but differ from their digest or contract.

`input_unavailable` has no fields beyond the state name. It carries no path, hash or body and grants no authority. It is not an integrity failure. The ledger treats the settled disposition as unproven, so the source receives fresh assessment, as ADR-0534 already specified.

Other readers keep their current behaviour:

- The convergence owner reads only the latest stage of an open obligation.
- Normalization lineage reads results that remain rooted.
- Settlement fences, effect checkpoints, workforce reuse and integration recovery compare hashes and read only their own proofs.
- Status, inspection, audit and `find-replay` do not read stage inputs.

### Read-only plan

`lervo state cas-retention --plan [--root <path>] [--json]` opens the project storage read-only and scans every reference once. It takes no worker lock and writes no projection, observation, event or unlink.

The plan reports `status` (`planned` or `unavailable`) and `failure`:

- `reference_changed`: a file kept changing across three reads.
- `bound_exceeded`
- `failed`

It also reports CAS totals, candidates past grace, retained objects and collectable objects. Collectable objects are broken down by reason:

- `unreferenced`: collectable under ADR-0534 alone;
- `event_writer_backup`: released by the backup rule;
- `assignment_input`: released by the assignment rule;
- `backup_and_assignment_input`: released only when both rules apply together.

The plan names no path, hash or body. It ignores the per-cycle deletion cap. The collector still removes at most 32 objects per cycle.

## Consequences

A read-only Node replay on 2026-11-18 applied these rules to each Mac repository's live event log, CAS objects and reference files. It opened the event log with `readOnly` and opened other SQLite files `immutable` unless they had a live WAL. Every backup row in every repository mirrored the live log.

| Repository            | CAS              | Candidates past grace | Unreferenced  | Backup rule    | Assignment rule | Collectable    |
| --------------------- | ---------------- | --------------------- | ------------- | -------------- | --------------- | -------------- |
| lervo                 | 9,417 / 7.28 GB  | 1,112 / 3.92 GB       | 2 / 5.6 MB    | 205 / 780.3 MB | 0               | 207 / 785.9 MB |
| argo                  | 15,527 / 0.94 GB | 3,702 / 518.4 MB      | 10 / < 0.1 MB | 273 / 44.3 MB  | 0               | 283 / 44.3 MB  |
| plen                  | 167 / 0.02 GB    | 17 / 9.7 MB           | 0             | 0              | 0               | 0              |
| digimon               | 217 / 0.03 GB    | 33 / 16.9 MB          | 0             | 0              | 0               | 0              |
| shiflo                | 720 / 0.02 GB    | 6 / 5.3 MB            | 0             | 0              | 0               | 0              |
| axli, flemo, axli-lab | 6,131 / 0.24 GB  | 0                     | 0             | 0              | 0               | 0              |

On its own, the assignment rule releases nothing on the Mac. ADR-0584 counted 526 lervo candidates (2.07 GB) that were rooted only by `assignment.created` events. Its replay counted only canonical events. A full reference scan shows that a retained stage result names each of those inputs. Most are also named by a provider stage observation or a failure proof, and about 138 by a live workforce record. Releasing those inputs would need a separate decision about those records. The WSL figures remain unknown.

A pass that releases 207 lervo objects needs at least seven sweeping cycles.

## Verification

Tests and builds were not run on the Mac, and WSL was not accessed. GitHub CI runs typecheck, lint and tests. These new tests fail before this change:

- an object named only by a mirrored backup is collected;
- a diverged backup row and a backup row missing from the live log keep their objects;
- a settled, archived assignment input is collected, while the latest settled stage input, an open obligation's input and the archive remain;
- the reader reports `input_unavailable` for the pruned input instead of throwing;
- the plan reports `unreferenced` and `event_writer_backup` separately and deletes nothing.

No live store was written.
