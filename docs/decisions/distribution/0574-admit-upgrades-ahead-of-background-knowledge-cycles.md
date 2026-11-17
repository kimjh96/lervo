# ADR-0574: Admit upgrades ahead of background knowledge cycles

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0214](../operations/services/0214-bounded-repository-upgrade-orchestration.md) (apply acquires admission with priority), [ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) (how an upgrade acquires the full-cycle admission), [ADR-0485](../knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) (where a holder yields)
Related: [ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) (Stage 2, S3)

## Context

On v0.23.7, publication to the last current repository took 35.6 minutes. Repository upgrades set the critical path, and 7 of 16 runs printed the full-cycle admission wait ([ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md)).

The code shows where that wait came from. `lervo upgrade --apply` takes the host's full-cycle admission ([ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md)). Admission was strictly first come, first served:

1. **The upgrade queued behind every waiting resident.** Each queued resident then ran a cycle. Before its first convergence stage, a cycle runs freshness preparation, owner-turn capture, practice and change review, and each can call a provider. The [ADR-0485](../knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) check skips the first convergence stage, so that stage always ran as well.
2. **The holder yielded only between convergence stages.** Waiting did not stop the other parts of a cycle.
3. **Upgrades run one repository at a time.** While one upgrade holds admission, residents of other repositories pile up. The next upgrade then joins the back of that queue.

A read-only sample of the Mac queue on 2026-11-17 confirmed this. Two to four residents waited at almost every sample. The `argo` Node worker held the slot for 6.4 minutes, and the `axli` resident held it for about 9.5 minutes, while `argo` waited more than 12.

## Decision

### An upgrade asks with priority

`acquireFullCycleAdmission` takes `priority: "resident" | "upgrade"`, which defaults to `resident`. `lervo upgrade --apply` asks with `upgrade`.

An upgrade registers its turn with `since` set one year in the past. Every reader orders waiters by `since` and then nonce, so the next free slot goes to the oldest waiting upgrade, and then to residents in arrival order. Upgrades keep arrival order among themselves. The admission database keeps its existing columns, so residents from earlier releases admit an upgrade first as well.

### A running cycle stops at its next stage boundary

`FullCycleAdmission.preempted()` reports whether an upgrade is waiting: a live waiter registered more than half a year back. The resident passes it to the worker as `yieldToUpgrade`. The worker asks before each stage of a cycle:

- On the convergence owner, or a single-host resident: before freshness preparation, retention, owner-turn capture, practice, change review, convergence, and document freshness.
- On a non-owner: before owner-turn capture and before workspace retention and debt inspection.

When it answers true, the cycle returns `{ status: "busy", reason: "knowledge_cycle_yielded_to_upgrade" }` and releases admission. Each stage first finishes its own durable writes and fences. Nothing is cancelled mid-write, and no new boundary is invented. A provider call in progress finishes first.

A yielded cycle counts as `processed`, so the fingerprint skip never hides the work it left. The resident runs again after its base delay. It waits for the upgrade's admission, then continues.

A resident only waiting behind another resident keeps the [ADR-0485](../knowledge/semantics/0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) rule: it stops after its next convergence stage. Yielding at every stage to another resident could stop every cycle before it does any work. An upgrade is one bounded command, so yielding to it cannot repeat forever.

### What stays

- The upgrade still holds admission from the plan check through its last stage. ADR-0484's exclusion and ADR-0487's single window are unchanged.
- `knowledge_cycle_admission_wait_expired` stays the backstop after 15 minutes. A holder from an earlier release, a long provider call, or another upgrade can still hold the slot that long.
- The wait notice now reads `Waiting up to 15 min for the running background knowledge cycle on this host to stop at its next stage boundary before upgrading.`

### Knowledge materialization stays in the upgrade window

[ADR-0571](0571-install-the-verified-cli-on-each-host-and-roll-back-by-activation-id.md) also planned to move knowledge materialization that an upgrade only schedules to the next normal cycle. This decision does not do that. With current ownership, it would weaken a guarantee:

- Only the convergence owner, with an active delegation, applies the structural knowledge and instruction-bridge plans in its lifecycle stage. A non-owner host does not rebuild its ignored `docs/knowledge/` publication. Today the upgrade rebuilds it on every host.
- A resident still on the previous runtime compiles with the previous compiler. It sees the old output as current.
- A parked or `waiting_authority` convergence never reaches the lifecycle stage. The upgrade would report `current` while the knowledge is stale.
- Any deferred materialization still holds admission for its whole stage. If it starts between two upgrades on one host, the next upgrade waits for it.

A later decision must name the process that runs the deferred work on every host, how it uses the new compiler, and how a plan reports it until it is done. Until then, ADR-0214's knowledge stage runs inside the upgrade window.

## States, privacy, and failure meaning

No event, file, or column is added.

- Waiter row: the existing columns. An upgrade's `since` is its arrival time minus one year. It holds a process ID, a nonce, a repository path hash, and times, but no path, prompt, or content.
- Resident health `busy` with reason `knowledge_cycle_yielded_to_upgrade`: the resident's existing health row, with no new field. It is not a failure. The cycle stopped between stages because an upgrade was waiting, and its remaining work is still due.
- If the admission database cannot be read, `preempted()` answers false, as `contended()` does. The cycle continues, and the 15-minute backstop still bounds the upgrade's wait.

## Consequences

An upgrade now waits at most for the stage the holder is in, instead of for one partial cycle per queued resident. Estimated, not measured: runs that only replace services drop from 1.9 to 3.5 minutes toward their apply time. The `lervo` runs keep their long knowledge stage (9.5 minutes of `knowledge_materialization` on the Mac, 11.1 minutes of apply on WSL), so the 12-minute target also needs the hand-off described above. Between two upgrades, the plan-only `lervo upgrade` leaves a gap in which a resident can start a long stage.

## Verification

- `full-cycle-admission.test.ts`: upgrades go ahead of residents that waited longer and keep arrival order; `preempted()` is true only for an upgrade.
- `upgrade-priority-yield.test.ts`: a running cycle stops before its next stage for a waiting upgrade with no convergence stage run; the upgrade is admitted before a resident that waited first; the next cycle runs the work left behind.
- `loop.test.ts`: a waiting resident stays behind an upgrade that asked later, then runs its cycle.
- `upgrade-resident-exclusion.test.ts`: `lervo upgrade --apply` goes ahead of a resident that waited first; `knowledge_cycle_admission_wait_expired` still ends a wait.

Installed verification: run `upgrade-all.sh` on Mac and WSL after the release that carries this change, and record each run's wait notice and duration in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
