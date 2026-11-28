# ADR-0660: Keep CAS retention due until the store settles

Status: `accepted`
Decision date: 2026-11-28
Amends: [ADR-0584](0584-let-cas-retention-finish-a-pass-on-a-live-host.md) (the per-cycle read bounds and the 32-object sweep cap), [ADR-0658](0658-name-what-stops-cas-retention-and-tombstone-what-it-prunes.md) (the observation says whether work is left), [ADR-0602](../../knowledge/maintenance/0602-wait-on-change-tokens-and-guard-idle-timers.md) (retention with work left is a local due time)
Related: [ADR-0534](0534-bound-installed-runtimes-and-convergence-artifacts.md), [ADR-0610](../../knowledge/maintenance/0610-write-lervo-effects-only-on-the-base-branch-as-commits.md), [project CAS retention](../../../specs/background-knowledge-convergence/recovery-and-retention/project-cas.md)

## Context

CLI v0.69.0 shipped ADR-0658, so retention on the WSL checkout could finally run. An hour later, its CAS still held 19,997 objects and 20 GB:

- The scan projection had classified only 296 records.
- The observation read `status: yielded`, `removedObjects: 0`. Its `observedAt` was 10:33Z, and at 11:20Z nothing had changed.
- `resident-cycle.json` read `lastResult: "waiting"` and `nextReconcileAt` at the next UTC day. The host's only provider was unavailable, and no change arrived.

Retention runs inside a knowledge worker cycle, before the owner gate and every provider stage. Under ADR-0602 an idle resident runs a cycle only for a change or a due time, and a pass that stops with work left was neither. Each cycle also advanced little: 1 s of reads, about 300 record probes on WSL, and at most 32 unlinks. At that rate a 20 GB store needed weeks of busy cycles and never shrank while the host was quiet.

## Decision

1. **The observation says whether work is left.**
   - `cas-retention-observation.json` gains the boolean `remaining`. It is true when the pass stopped with unclassified records, unread references, eligible candidates still to sweep, or a stall below the five-stall attention bound.
   - It is false when the pass finished, found nothing eligible, was not due, or failed (`unavailable`, which needs the owner).
   - A pass that yielded before it read its scan learned nothing new and carries the previous answer.
2. **Remaining work is a local due time.**
   - The resident's change fence reads the observation. While `remaining` is true, the next slice is due 30 s after its `observedAt`. This works like practice and the daily skill window, so a non-owner wakes for it too.
   - A due time that has passed forbids skipping the cycle, so the next cycle runs in full although no fingerprint input changed. The observation is not in the fingerprint.
   - After a full cycle whose own pass left work, the next cycle is due 30 s after that cycle ended, however long its provider stages took.
   - A pass the cycle did not run, such as on a held or off-base checkout, asks for nothing. An old observation can therefore never loop the resident. The ADR-0610 skip is unchanged.
3. **A slice is time-boxed, not counted.**
   - The sweep removes at least 32 objects, unless it yields or the head moves. It then continues until 5 s after the pass began, with a backstop of 4,096 unlinks.
   - The sweep probes live work at most once per 100 ms instead of before every unlink. The event head and the materialization state are still checked before each one.
   - One slice's body scan admits 16,384 reads, 512 MiB and 4 s of read time. Time binds first on a slow disk and bytes on a fast one. Yield probes still run between reads and still cost no read time.
4. **Every ADR-0658 safety property is kept.** This covers the settle loop, the head and identity re-check after the tombstone, the tombstones themselves, the 14-day grace, the worker lock, and the yields to live work, upgrades and other repositories' full cycles.

## Consequences

- A quiet host, or one whose provider is unavailable, keeps running one slice about every 35 s until the store settles. It then returns to waking only for changes and due times. Each slice is a full worker cycle: its other stages find nothing to do, and a paused or unauthorized provider stage defers as before.
- Measured on the Mac with 3,001 eligible 64 KiB objects, each slice took 5.0 s of wall time and 0.6–0.8 s of CPU. A slice removed about 500 objects, bound by the fsync of each tombstone, and all 3,001 cleared in seven slices. Before this change each pass removed 32. WSL disks are slower. At 32 to 500 removals per slice, its roughly 15,000 removable objects clear in hours, not weeks.
- Inventory listing and the settle rounds sit outside the 5 s box. On a store of 20,000 objects they add a few seconds per slice, and so does the minimum of 32 unlinks on a very slow disk.
- While the owner works, a pass yields at once. If it yielded before reading its scan, it keeps `remaining`, so the resident looks again every 30 s; event wakes already run cycles about that often during live work.
- A stall at the bound, or an `unavailable` pass, stops the early cycles. Attention reports both as before, and retention still runs whenever another reason starts a cycle.
