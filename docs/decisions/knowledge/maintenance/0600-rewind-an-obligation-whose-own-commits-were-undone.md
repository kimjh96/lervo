# ADR-0600: Rewind an obligation whose own commits were undone

Status: `accepted`
Decision date: 2026-11-20
Amends: [ADR-0434](../repository/canonicalization/0434-converge-background-canonicalization-normalization-and-knowledge.md) (what discovery does when the observed baseline is an open obligation's own), [ADR-0594](0594-keep-knowledge-publication-moving-and-apply-owner-rules-on-every-host.md) (a supersession or publication reset can undo an open obligation's commits)
Related: [ADR-0598](0598-keep-an-owner-resident-from-waking-itself.md), [core loop roadmap](../../../roadmap/core-loop.md) item 6

## Context

After v0.29.6, the WSL owner worker for flemo still used about 26 percent of a CPU core. Its convergence status had read `normalization_generation stale source_bytes_changed` since 2026-11-14. In that time it recorded 7,886 `queued` and 7,883 `stale` stage records for one obligation, about one pair every 66 seconds, although no file in flemo's working tree changed.

1. **Something undid the obligation's own commit.** Obligation `kconv_3475…` opened at baseline snapshot `d418…`. Its normalization apply committed `cb4a12f0` at 02:30:06Z, which moved the obligation's stage snapshot to `272b…`. Fifteen seconds later the branch was reset back to `d3dcf699` by a knowledge supersession or a publication sync (ADR-0594). The repository bytes were again the obligation's own baseline `d418…`, while its latest stage was still bound to `272b…`.
2. **The requeue could never succeed.** The next stage checked its input snapshot `272b…` against the repository at `d418…` and settled `stale` with `source_bytes_changed`. The dependency check then saw that the stall's snapshot no longer matched the repository and requeued the same stage at the same `272b…`, which failed again.
3. **Discovery could not replace it.** Discovery looks for an open obligation whose latest snapshot equals the observed one, and finds none. The new obligation id is a stable hash of the snapshot, policy, debt and delegation, so it is the stuck obligation's own id. Discovery saw that the baseline event already existed and returned.
4. **No attention ever showed.** Each requeue started a new delivery at attempt zero, so the 16-attempt ceiling and `knowledge_retry_exhausted` were never reached.

## Decision

### Discovery rewinds an obligation whose own effects were undone

When discovery computes an obligation id that already exists, it checks that obligation. If it is still open, its latest stage settled `stale`, that stage is bound to a snapshot other than the observed one, and the observed snapshot is the obligation's own baseline, then the repository was reset under it. Discovery appends a `queued` assessment stage at the baseline snapshot with the baseline input artifact and enqueues it. The obligation restarts from assessment; nothing it recorded is rewritten.

A repository that moved to other bytes still gets a new obligation that supersedes the old one, as before.

### Three rewinds at most, then attention

While an obligation is open, an owner who deliberately reverts its commit back to the baseline looks exactly like a sync reset: Lervo sees the same bytes and the same stale stage either way. Without a bound, a rewind would re-apply work the owner reverted, and a reset that recurs after every run would loop through the provider-backed stages forever.

Each rewind is counted durably. Its `queued` record names a rewind evidence artifact in `dependencyHash`, which no other queued handoff sets, so discovery counts the obligation's earlier rewinds from its own records when the next one is due. After three rewinds, the next undone effect settles the obligation instead: discovery appends one `attention_required` stage record with `failureCode: "knowledge_effect_undone_repeatedly"` and no dependency. Nothing more is recorded for that obligation. If the repository later moves to other bytes, a new obligation supersedes it.

The cap is what bounds Lervo re-applying reverted work. ADR-0594's supersession ledger does not: it matches commits by SHA and patch, and a regenerated commit gets a new SHA.

### A stale stage reruns only at the bytes it was bound to

A stage settles `stale` only for `source_bytes_changed`. Requeuing it at a snapshot the repository has left repeats the same failure, so the dependency resume no longer does that. A stale stage reruns when the observed snapshot equals the one it was bound to. Otherwise discovery decides: it rewinds the obligation or opens a successor.

### A requeued stale stage keeps its attempts

The `queued` stage record carries the attempts its stale predecessor spent, and the owner counts a delivery's attempts as its own plus that carried count. A rewind carries them too. A mismatch that never clears therefore reaches the 16-attempt ceiling and settles as `attention_required` with `knowledge_retry_exhausted`, which ends the requeues. Fresh stage handoffs carry zero, so ordinary stages count as before.

## States, events, privacy, and failure meaning

- **Events:** no new type or field. A rewind is an ordinary `repository.knowledge.stage.recorded` with `state: "queued"`, `stage: "assessment"`, the baseline snapshot and the baseline input artifact. Its `attemptCount` (0–16, already in the schema) now carries prior attempts instead of always 0. Its `dependencyHash` names the rewind evidence artifact.
- **Rewind evidence artifact:** `{ schemaVersion: 1, kind: "obligation_rewind", rewind, undoneSnapshotHash, baselineSnapshotHash }` in the project CAS. `rewind` is 1–3; the two snapshot fields are content hashes.
- **`knowledge_effect_undone_repeatedly`:** a failure code on a `repository.knowledge.stage.recorded` with `state: "attention_required"`. The record names the stale stage it follows, that stage's snapshot, attempts, input and result artifacts, `nextObligationId: null` and `dependencyHash: null`. It means a reset or an owner revert undid this obligation's own commits a fourth time after three rewinds, so Lervo stops re-applying them. Recovery: the owner decides whether the reverted knowledge outputs should land. Any change to the repository's bytes opens a fresh obligation that supersedes this one.
- **States:** unchanged. `stale` still means the stage's bytes moved. A stale stage that exhausts its attempts now settles `attention_required` with `knowledge_retry_exhausted` instead of `stale`.
- **Privacy:** the rewind record, its evidence and the attention record hold only hashes, counts and existing artifact coordinates; no path, content or message.
- **Failure meaning:** a rewind that cannot enqueue because the outbox is at its ceiling is recovered by the existing outbox reconciliation, which enqueues any open `queued` stage.

## Consequences

- **flemo:** on install, the stuck obligation rewinds once and regenerates its normalization at `d418…`. The 66-second stale and queued pairs stop.
- **Repeated undoing:** a reset that undoes the regenerated commit again rewinds the obligation again, at most three times. The fourth undo settles it as `knowledge_effect_undone_repeatedly` attention. The carried attempts don't bound this case, because a successful stage starts its successor at zero.
- **Owner reverts:** an owner who reverts Lervo's commit during an open obligation sees it re-applied up to three times before Lervo stops and reports attention.
- **Counting cost:** discovery reads the obligation's stage records only when a rewind is due, which happens only after an undone effect.
- **Stale stages at the same bytes:** a stage that went stale while the repository briefly moved and then came back now reruns, where before it stalled until a new baseline appeared.
- **Dropped commits and the working tree:** `reset --keep` rewrites every path that differs between the old head and the target, and refuses when such a path has local edits. A supersession or publication sync therefore cannot leave a dropped commit's outputs as uncommitted edits. The uncommitted Lervo outputs found in flemo on WSL predate these resets and touch no path the dropped commits changed. The Mac's flemo checkout holds the same edits, so they arrived through replica worktree replication. They are reported to the owner and are outside this decision.

## Verification

`packages/repository-knowledge/test/knowledge-convergence-owner.test.ts`:

- an obligation whose canonical integration commit is reset to its baseline goes stale once, rewinds to assessment once, and then completes; no stale and queued pairs repeat;
- a stale stage is never requeued at bytes the repository has left; the next stage after the reset is the rewound assessment;
- a stage whose bytes never match settles `attention_required` with `knowledge_retry_exhausted` after 16 attempts, and later cycles record nothing more;
- an obligation whose commit is reset after every run rewinds three times, then records exactly one `knowledge_effect_undone_repeatedly` attention and no further stage records.
