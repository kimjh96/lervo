# ADR-0660: Keep CAS retention due until the store settles

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) (the per-cycle read bounds and the 32-object sweep cap), [ADR-0658](0658-name-what-stops-cas-retention-and-tombstone-what-it-prunes.md) (the observation says whether work is left; read-budget stalls), [ADR-0602](../../knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md) (a retention deadline beside the reconcile deadline)
Related: [ADR-0574](../../distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md), [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md), [ADR-0610](../../knowledge/maintenance/0610-write-lervo-effects-only-on-the-base-branch-as-commits.md), [project CAS retention](../../../specs/background-knowledge-convergence/recovery-and-retention/project-cas.md)

## Context

CLI v0.69.0 shipped ADR-0658, so retention on the WSL checkout could finally run. An hour later, its CAS still held 19,997 objects and 20 GB:

- The scan projection had classified only 296 records.
- The observation read `status: yielded`, `removedObjects: 0`. Its `observedAt` was 10:33Z, and at 11:20Z nothing had changed.
- `resident-cycle.json` read `lastResult: "waiting"` and `nextReconcileAt` at the next UTC day. The host's only provider was unavailable, and no change arrived.

Retention runs inside a knowledge worker cycle, before the owner gate and every provider stage. Under ADR-0602 an idle resident runs a cycle only for a change or a due time, and a pass that stops with work left was neither. Each cycle also advanced little: 1 s of reads, about 300 record probes on WSL, and at most 32 unlinks. At that rate a 20 GB store needed weeks of busy cycles and never shrank while the host was quiet.

The first design made remaining retention a due time in the change fence. Review rejected it: a due fence time runs the whole worker, with every provider stage, every 30 s. Some stages pay for a provider call again on each cycle, and the owner limits token use.

## Decision

1. **The observation says whether work is left.**
   - `cas-retention-observation.json` gains the boolean `remaining`. It is true when the pass stopped with unclassified records, unread references, eligible candidates still to sweep, or a stall below the five-stall attention bound.
   - It is false when the pass finished, found nothing eligible, was not due, or failed (`unavailable`, which needs the owner).
   - A pass that did no work writes no observation. Such a pass either yielded at entry, to live work or a materialization, or found the host's retention turn taken. The last observation therefore keeps its `observedAt` and its answer. A host held by live work for three days shows `cas_retention_stale`, which is true: no pass ran.
2. **A retention-only wake runs only retention.**
   - The resident keeps a `retention` deadline beside `reconcile`. When it falls due, the resident runs one retention slice and nothing else. It starts no worker cycle, no provider stage and no other stage, and it never changes the change fence. Only a fingerprint change or the existing reconcile deadline runs the full worker.
   - The slice applies the full cycle's rules. The owner hold and the ADR-0610 base-branch rule stop it. A current developer lease stops it before it starts. It holds the host's full-cycle admission, the repository's worker lock and the host retention turn. The materialization check and every ADR-0658 step are unchanged: the settle loop, the head and identity re-check after the tombstone, the tombstones and the 14-day grace.
   - The slice never queues for the admission. If a full cycle holds or waits for it, the slice does not start, because a waiter would make that cycle yield at its next stage. While it runs, a full cycle that arrives makes it yield.
   - After each full cycle, a recorded pass that left work, is not `unavailable` and is less than a day old arms the deadline 30 s later. After a slice:
     - A slice with work left arms it again 30 s later. One without arms nothing.
     - A held or off-base checkout arms nothing; the full cycle that its release or checkout switch causes looks again.
     - A busy admission retries 30 s later. A taken turn retries when the host's turn opens.
     - Live work, or a pass that yielded at entry, doubles the wait from 30 s up to 10 minutes. The next slice that does work restores 30 s.
3. **The host paces retention, not each repository.**
   - The host admission database holds one `retention_turns` row per repository.
   - A pass that has work due asks for a turn before it reads anything. A turn starts only 30 s after the host's previous slice ended. It goes to the live request that has waited longest; a request counts as live while it was renewed within 60 s.
   - A repository that finishes with work left queues again behind the others. One without work withdraws its request.
   - Full cycles take their retention through the same turns. The whole host therefore reads at most one slice's budget per 30 s, however many repositories it serves. A repository that stops asking, for example behind live work, keeps its place for when it asks again.
4. **A slice is time-boxed, not counted.**
   - The sweep removes at least 32 objects, unless it yields or the head moves. It then continues until 5 s after the pass began, with a backstop of 4,096 unlinks.
   - The sweep probes live work at most once per 100 ms instead of before every unlink. The event head and the materialization state are still checked before each one.
   - One slice's body scan admits 16,384 reads, 512 MiB and 4 s of read time. Time binds first on a slow disk and bytes on a fast one. Yield probes still run between reads and still cost no read time.
5. **A slice that reads without progress is a stall.**
   - A slice whose read budget ran out counts a stall with cause `read_budget_exhausted` if it advanced nothing. Advancing means classifying a record, caching a report, or reading further into a file at the identity it had before. The stall counts toward the same five-stall bound.
   - A slice that does advance ends a read stall. Other stall causes still end only when a pass removes or finishes.
   - An unchanged file resumes from its saved offset or SQLite cursor across slices, as before. A file that changes between slices restarts, and the stall names it in `stallReference`, relative to the repository. At the bound, `remaining` turns false, and attention reports `cas_retention_stalled` with the path.

## Consequences

- A quiet host, or one whose provider is unavailable, keeps pruning without any provider call. Each repository runs one slice about every 35 s while it alone has work. With several repositories, the host runs one slice every 35 s in turn.
- Measured on the Mac with 3,001 eligible 64 KiB objects, each slice took 5.0 s of wall time and 0.6–0.8 s of CPU. A slice removed about 500 objects, bound by the fsync of each tombstone, and all 3,001 cleared in seven slices. Before this change each pass removed 32. WSL disks are slower. At 32 to 500 removals per slice, its roughly 15,000 removable objects clear in hours, not weeks, if it is the only repository with work.
- Inventory listing and the settle rounds sit outside the 5 s box. On a store of 20,000 objects they add a few seconds per slice, and so does the minimum of 32 unlinks on a very slow disk.
- A retention-only attempt costs a hold read, one `git` call for the base branch, a lease listing and an admission read. While live work holds, attempts back off to one every 10 minutes.
- A full cycle that finds the turn taken skips retention for that cycle; the retention deadline picks it up.
- A stall at the bound, or an `unavailable` pass, arms nothing. Attention reports both, and retention still runs whenever a full cycle starts and the turn is free.
