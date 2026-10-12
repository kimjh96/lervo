# ADR-0508: Observe standing supervision only when its source can differ

Status: `accepted`
Decision date: 2026-10-13
Amends: [ADR-0461](0461-drive-resident-runtime-service-work-from-changes-not-timers.md)

## Context

[ADR-0461](0461-drive-resident-runtime-service-work-from-changes-not-timers.md) made resident services change-driven. Standing supervision kept a 60-second authority tail audit, which still observes the whole task source.

The history readers set the loop's next wake-up 60 seconds after each read. That deadline is always in the future, so the lapsed-deadline backoff never starts. Every minute the loop runs a full cycle:

- It refreshes peers and pending result deliveries.
- It finds the pending plan.
- It reads the task source twice to prove it stayed stable, and the recovery authority once.

The orchestrator compares the source digest only after all of that work. On an unchanged source, it then returns without acting.

On the WSL host, the axli Node used a single-threaded 10-second burst every minute while its event store received no events for 40 minutes. Breakpoint counters on the live process measured one idle cycle:

- 2,651 reads of the repository role directory: every assignment and agent in every listing resolved its role contract by reading all role files again.
- 18,930 reads of coordination records: each of 21 retained-workspace proofs listed every workspace coordination event.
- 84 Git processes to resolve the coordination home, and 21 workspace Git inspections.
- 10 agent registry normalizations and 24 per-assignment history reads.

Process CPU stayed between 17% and 23% of a core in 60-second samples. Part of the cost repeats the same reads inside one cycle. The rest repeats a whole cycle whose result cannot differ.

## Decision

Two changes, neither of which alters what an observation concludes.

**One read per source per listing.** Within one listing or batch, each source is read once and shared, the pattern already applied to capability packages:

- `createRoleContractResolver` reads the role sources once per agent or assignment listing.
- A batch of retained-workspace proofs shares one read of the supervision history and the workspace coordination events. Each proof still ends by checking for relevant events after that shared head, so the check covers more events than before.

**Skip a wake-up only when it would repeat the last observation.** `SupervisionObservationGate` wraps the supervision cycle. It skips a full observation only when all of these hold:

- The last cycle ended `idle` or `blocked` with no report: the orchestrator itself found the source unchanged.
- No local or peer change hint arrived since that cycle started.
- The event store head (sequence and hash) is unchanged.
- No lapsed duty deadline exists: the cursor's next check, mandate expiry, the next peer audit, or a result-delivery retry.
- A stamp of every file the agent and assignment listings read is unchanged. `workforceSourcePaths` lists the project manifest, `agents.json`, and the assignment, role, and capability package trees; the stamp records each entry's device, inode, mode, size, and nanosecond modification and change times.
- The last full observation is less than 900 seconds old, the cadence of full history audits.

An unresolved preflight block also ends in an unchanged skip. That block holds new proposals until an event resolves it, but the resolution is not part of the source digest. So the orchestrator never remembered this blocked state and re-evaluated it on every wake-up; the axli supervision has waited in it since a preflight block was recorded. `supervisionCursorDigest` now adds the latest unresolved block's event ID to what an unchanged skip compares, and the blocked path remembers its cursor like other blocked waits. Recording or resolving a block changes that identity, so the next cycle evaluates again. The orchestrator port is now `findUnresolvedPreflightBlock`, which returns that event ID.

A skipped wake-up still runs the tail audit through `NodeSupervisionStore.auditHistory`. That audit checks the anchor and reads appended events, so a missed hint is still found within 60 seconds. If any check fails, if the stamp exceeds 4,096 entries, or if the store is busy, the full cycle runs. A result delivery waiting for a retry exposes its time through `nextRetryAt`, which now also wakes the loop. Before, the retry depended on the 60-second wake-up.

## Consequences

An idle supervisor costs one tail audit and one stamp per minute. A full observation runs at least every 15 minutes, and after any hint, event, input-file change, or deadline.

Effects keep their checks: every effect still runs inside a full cycle that re-reads authority, admission, and readiness. A skipped wake-up records nothing and authorizes nothing.

State the stamp does not cover, such as an external Git change inside a retained workspace, is observed at the next full observation. That bound is now 15 minutes instead of 60 seconds. Such a change does not feed the source digest, so the orchestrator would also have returned unchanged for it; it cannot allow an effect on its own.

The gate holds its state only in process memory. A restart observes in full.

The resolver and the batch-shared sources keep their callers' failure behavior. They change only how often each source is read.
