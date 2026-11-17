# ADR-0580: Let a resident with parked work back off

Status: `accepted`
Decision date: 2026-11-17
Amends: [ADR-0461](../../operations/services/0461-drive-resident-runtime-service-work-from-changes-not-timers.md) (which results are idle-class), [ADR-0463](../documents/0463-refresh-stale-documents-with-evidence-bound-minimal-edits.md) (when a pending no-change review reopens the freshness stage)

## Context

On 2026-11-17 the owner reported that Lervo still kept a CPU core busy. On WSL, the resident `knowledge-worker` child for the `lervo` repository had used 102 minutes of CPU in 2 hours 36 minutes, and `top` showed it at 100%. Read-only observation found:

- **The resident never went idle.** `resident-cycle.json` showed `lastResult: processed` and `idleStreak: 0`. A full cycle started about every 2 minutes and used more than one core for about 70 seconds. The main JavaScript thread accounted for 91 of those 102 minutes.
- **Convergence was parked.** The maintenance observation showed `state: retry_scheduled` for `normalization_generation`, attempt 14 of 16, with `nextAttemptAt` 30 minutes later. The resident classified every state outside `idle`, `waiting_authority`, `attention_required`, and `recovery_required` as `processed`. A full cycle resets `idleStreak` to 0, so the next cycle ran after the 60-second base and never consulted the fence.
- **Freshness kept waking the resident.** The event store held one `document.freshness.cycle.completed` about every 6 minutes. Each one carried the same payload: 73 findings, 0 admitted, 70 skipped for budget. The candidate store held one `generated` `no_change_needed` candidate, and the day's budget was spent.

Before running the stage, the freshness stage bypassed its own fence whenever a `generated` `no_change_needed` candidate existed, so that the pending assessment could run. The assessment itself runs only when the day's budget covers one more candidate. When it does not, the stage observes every finding again, runs the full knowledge lint, and appends a cycle event that says nothing new. The appended event moves the event head. That wakes the resident, resets its idle streak, and changes the fence fingerprint, so the next cycle runs in full and repeats the stage.

To measure without touching live state, a copy of the WSL repository ran the resident from an origin/main build. `/home` was read-only and the network unreachable, so the copy's provider was not admitted and its convergence settled in `waiting_authority`, a parked state. Per-scope cost from that run:

| Scope                        | CPU per full cycle | Repository scans |
| ---------------------------- | ------------------ | ---------------- |
| `convergence`                | 52 to 56 s         | 4                |
| `freshness`                  | 46 s               | 4 (full lint)    |
| `freshness_prepare`          | 45 s, every third  | 4                |
| `artifact_retention`         | 9 s                | 0                |
| Whole cycle (first excluded) | 106 to 156 s       | 8 to 12          |

Over 20 minutes it ran 7 full cycles, about 21 per hour, and used 987 seconds of CPU: 81% of one core. No cycle was skipped. Every cycle's idle streak was 1, because its predecessor's freshness event woke it.

Both behaviors are the same fault. Work that is waiting for time or budget was treated as work in progress, so a repository with nothing to do never reached the idle backoff that ADR-0461 defines.

## Decision

### A retry parked in the future is idle-class

When a completed full cycle's convergence state is `retry_scheduled` and its `retry.nextAttemptAt` is later than the moment the cycle finished, the resident records `lastResult: idle`. The idle streak grows, and the fence may skip later cycles, as it does for an idle repository.

The attempt itself is never delayed:

- The fence was observed before the cycle, so it cannot see a retry the cycle itself rescheduled. The next timer therefore takes the earliest future moment of the fence's `earliestAvailableAt` and the parked retry's `nextAttemptAt`, and ADR-0461's delay formula wakes the resident no later than that moment.
- A delivery that is already due is never skipped, so the cycle that wakes for the attempt always runs in full.
- A `retry_scheduled` state whose next attempt is already due stays `processed`. The resident keeps its base cadence until the delivery is claimed.

Health is unchanged: a full cycle already reported `retry_scheduled` as `idle`, and a skipped cycle now reports `idle` with reason `source_unchanged`.

### A pending no-change review reopens freshness only when it can be paid for

The freshness stage's fence bypass for a `generated` `no_change_needed` candidate now applies only while today's budget covers one more candidate at `maximumTokensPerCandidate`. When it does not, an unchanged fence returns `unchanged`. The stage observes nothing, runs no lint, and appends no event.

No work is lost. The stage fence includes the day, so the first cycle of a new day reopens the stage with a fresh budget. The assessment branch itself keeps checking the budget after any cross-check spend in the same cycle, as before.

### What still costs CPU

The 15-minute reconciliation ceiling still runs one full cycle per quarter hour on an idle repository. On the copy, that cycle repeats the repository scan 8 to 12 times. Sharing one scan across a cycle's stages is a separate change, recorded below as a follow-up.

## States, events, privacy, and failure meaning

No event, file, field, or reason code is added.

- `resident-cycle.json` keeps its schema. `lastResult: idle` may now follow a parked `retry_scheduled` convergence state.
- The freshness stage may return `unchanged` while a `generated` `no_change_needed` candidate waits for budget. Previously it always returned `completed` with an identical payload.
- Neither change reads or stores repository content, paths, or provider output.
- An unparseable `nextAttemptAt` counts as not parked, so the cycle stays `processed`. Ambiguity costs a full cycle, never a skipped one.

## Consequences

Measured on the same copy, restored to the same snapshot, with this change built from source:

| Measure                          | origin/main          | This change                  |
| -------------------------------- | -------------------- | ---------------------------- |
| Run length                       | 20 min               | 30 min                       |
| Full cycles                      | 7 (about 21 an hour) | 3                            |
| Process CPU                      | 987 s (81% of core)  | 320 s (18% of core)          |
| `freshness` scope per full cycle | 46 s                 | 0.02 to 0.06 s               |
| Steady-state full cycles         | every 2 to 3.5 min   | one per 15-minute ceiling    |
| Steady-state CPU per hour        | about 2,900 s        | about 260 s (4 cycles, 66 s) |
| Idle streak at the end           | 1                    | 5                            |

After the fix, the first cycle runs in full (187 s, including the startup observation), and its own appends cause one more full cycle (64 s). From then on the resident skipped every wakeup until the 15-minute ceiling ran one 66-second cycle. That ceiling cycle is now the remaining idle cost. The copy's convergence was in `waiting_authority`, so this run measures the freshness half of the fault. The live WSL state, a retry parked for 30 minutes, could not be reproduced without a reachable provider; the unit test below covers it, and it removes the same 2-minute cadence the live resident showed.

The exact fences before durable writes (ADR-0566) and the convergence stage contracts are untouched. The fence's skip contract still refuses due deliveries, failed cycles, missing state, and an elapsed ceiling.

### Follow-ups

- **Scan sharing within one cycle.** One idle full cycle scans the repository 8 to 12 times: twice 4 in `convergence/discover` when the second discovery misses the cycle-scoped observation, 4 in `convergence/dependency`, and 4 in the freshness lint. Verify by counting `scan` calls per scope in the cycle cost report.
- **Cycle cost from the Node child.** The Node `knowledge-worker` child does not print the per-cycle cost line that `lervo knowledge worker --watch --host` prints, so WSL had no per-stage report. Verify that the child's journal carries one cost line per completed cycle.
- **Non-owner ceiling cycles on the Mac host.** The Mac host resident is a non-owner for its 7 repositories. It runs a read-only debt inspection, 4 to 6 scans, at each 15-minute ceiling and after edits. From 12:00 to 16:00 UTC on 2026-11-17 those scans used about 2,200 seconds of CPU. The cost has a different cause from this decision: no self-trigger loop was found there.

## Verification

- `packages/repository-knowledge-runtime/test/resident-cycle.test.ts`: a parked retry records `idle`, its attempt bounds the next delay, the next unchanged cycle is skipped, and a due retry stays `processed`. Fails on origin/main.
- `packages/repository-knowledge-runtime/test/maintenance-recovery.test.ts`: with the budget spent, two cycles return `unchanged` and append no cycle event; restoring the budget runs the pending review at once. Fails on origin/main.
