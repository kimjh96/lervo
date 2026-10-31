# Change fence and scheduling

## Fingerprint

Before each resident cycle, the owner computes a fingerprint in tens of milliseconds: SHA-256 of canonical JSON over:

- `head`: the checked-out commit.
- `status`: SHA-256 of `git status --porcelain=v2 -z --untracked-files=all`, run with `--no-optional-locks` so observation never rewrites the index.
- `dirty`: type, size, `mtimeNs`, `ctimeNs` and inode of every path named by that status. This detects repeated edits to already modified files, whose porcelain output stays identical.
- `index`: Git index size and `mtimeNs`.
- `policy` and `delegation`: hashes of the reviewed source-capture policy and Git-ignored `.lervo/knowledge/convergence-delegation.json`.
- `candidates`: type, size, timestamps and inode of every directory and entry, two levels deep, below `.lervo/state/knowledge/*candidates`.
- `materialization`: metadata of `.lervo/state/knowledge/materialization-transaction`.
- `eventsHead`: hash of the latest canonical event.
- `outboxOutstanding` for `knowledge:convergence`, `knowledge:repository` and `knowledge:repository:requeue`, and `earliestAvailableAt`: the earliest pending `availableAt` or leased expiry. A listing truncated at 1,000 rows reports a delivery as already due.

## Skip contract

The resident skips a cycle only when all conditions hold:

- The previous full cycle returned `processed` with no change-job outcomes.
- Its convergence state was `idle`, `waiting_authority`, `attention_required` or `recovery_required`.
- The new fingerprint equals the stored fingerprint.
- No delivery is due.
- The last full cycle started less than 15 minutes ago.

Any fingerprint read failure, missing or invalid state, due delivery, or elapsed ceiling runs the full cycle. A skipped cycle reads no source bytes and replays no events. Equal fingerprints prove only that observed inputs did not change; they never establish document currency.

The stored fingerprint is observed before the full cycle starts, so an edit during the cycle changes the next fingerprint. The cycle's own appends cause at most one further full cycle.

Inputs outside the fingerprint, including generated registries below `docs/knowledge/` and other private state, are reconciled by the ceiling cycle within 15 minutes.

## Adaptive reconciliation

A one-shot timer replaces the fixed 60-second interval. Its delay is `min(ceiling, base × 2^(idleStreak − 1), earliestAvailableAt − now)`, with `base = 60_000` and `ceiling = 900_000` milliseconds. A future delivery wakes the resident no sooner than one second ahead. An already-due delivery never shortens the delay, preventing deferred work from busy-looping.

`idleStreak` counts consecutive idle-class, skipped or failed cycles, producing delays of 1, 2, 4, 8 and then 15 minutes. Change-job outcomes, a non-idle convergence state, or a busy repository lock reset the streak. Failed cycles keep backing off but are never skippable because they record no fingerprint.

Canonical event appends and repository edits wake the resident and reset the streak. The Node `knowledge-worker` child subscribes to `watchProjectEventChanges` and `watchRepositoryChanges`. A failed repository watcher wakes the resident once and restarts after 60 seconds. Wakeups retain the 30-second quiet window and 60-second maximum delay; the woken cycle still passes through the fence.

## Private cycle state

`.lervo/state/knowledge/resident-cycle.json` contains `{ schemaVersion: 1, fingerprint, lastCycleAt, lastResult, idleStreak, nextReconcileAt, lastFailure? }`.

- `lastResult`: `idle`, `waiting`, `attention`, `processed` or `failed`.
- `lastCycleAt`: start of the last full cycle.
- `fingerprint`: `null` after a failed cycle or unreadable fence.
- `lastFailure`: `{ code, detail, at }` after failure, `null` after a completed cycle. Readers accept its absence in older state. The [continuity specification](../../ownership-and-activation/continuity.md#resident-cycle-failure-diagnostics) defines code, detail, privacy, and doctor output.

The file contains digests, counts, timestamps, and one bounded failure diagnostic. Typed Lervo failure detail may contain repository-relative paths, never bodies. It is written atomically with mode `0600` and bounded to 4 KiB.

A missing, oversized or invalid file forces the next full cycle. Write failures are ignored: in-memory state continues, and the file is rebuildable.

## Health evidence

The fence uses the existing `reason` column, bounded to 128 characters. An idle resident that skips reports state `idle` with reason `source_unchanged`. This proves skipped work, never document currency.

A resident whose last full cycle was `waiting` or `attention` retains that state and its last reason while skipping. A skip cannot hide an operator-visible authority or recovery condition.

## Evaluation contract invalidation

[ADR-0485](../../../../../decisions/knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) adds the runtime evaluation contract to the fingerprint inputs above. Its identity is `adr-0485:<digest>`, where the digest covers the exact bytes of the module holding stage evaluation: the bundled runtime when installed, or the source file in development.

A changed evaluation contract changes the resident fence, so the new runtime runs a full cycle at once instead of skipping unchanged repository inputs until the reconciliation ceiling. Settled dependencies record `evaluationContract`; a dependency with a different or absent contract is requeued and reevaluated once under the current contract. Uncertain-effect and recovery dependencies retain their own inspection, so contract invalidation never authorizes blindly repeating a write. These rules add no canonical event or success claim.
