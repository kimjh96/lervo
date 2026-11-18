# ADR-0587: Abandon a background provider call for a waiting upgrade

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0574](0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (a provider call in progress no longer finishes first)
Related: [ADR-0484](../operations/services/0484-keep-upgrades-exclusive-with-background-knowledge-work.md) (upgrade exclusion), [ADR-0577](0577-keep-the-upgrade-exclusion-through-event-loop-stalls.md) (upgrade lease), [ADR-0580](../knowledge/maintenance/0580-let-a-resident-with-parked-work-back-off.md) (parked work and idle backoff)

## Context

On the v0.25.4 hands-off follower pass on 2026-11-18, the WSL `lervo` repository waited 703 seconds for full-cycle admission before its upgrade could apply (`waitMs: 703152` in the follower state). Under ADR-0574, an upgrade goes ahead of waiting residents, and the running resident stops at its next stage boundary. So one stage of one resident cycle held the host for almost 12 minutes. On the Mac, `axli` waited 415 seconds on the same pass and 339 seconds on v0.25.3.

Read-only evidence from WSL names the stage:

- **When the wait happened.** The pass finished at 01:22:13 UTC after 1,148 seconds and two rounds. Round 1 applied its knowledge materialization at 01:05:03, so its wait was short. The stages that round 2 ran inside admission took 143 seconds, so round 2 was admitted at about 01:19:50. Nearly all of the 703 seconds fell in round 2, from about 01:08 to 01:19:50. Between the rounds, the upgrade released admission while its plan-only command ran, and a resident cycle started.
- **What the holder did.** `convergence-budgets.sqlite` was last written at 01:09:47, when a convergence provider call reserved its budget for obligation `kconv_9d0814fb0d176d2cb01bf54f`. `provider-cli-selection.json` records `observedAt: 01:19:47.529Z`; the runtime writes it when a provider process ends. The two are 600 seconds apart. Only normalization generation runs a provider call with a 600-second timeout; convergence reviews and change review use 300 seconds.
- **Which stage it was.** The maintenance observation names `activeStage: normalization_generation`, in `attention_required` with `knowledge_retry_exhausted`, and 262 documents of normalization debt. A generation call that times out is a transient failure, so the stage had been retried until its attempts ran out.
- **Who else waited.** The `flemo` resident on the same host recorded stage events until 01:07:37 and none until 01:22:21, 8 seconds after the `lervo` upgrade released admission.

So a provider call that ran to its 10-minute timeout held host-wide admission. ADR-0574 had decided that "a provider call in progress finishes first". The stage boundary therefore came only after the timeout. The same holds for every background call made inside a cycle:

| Call                                                              | Timeout |
| ----------------------------------------------------------------- | ------- |
| Normalization generation                                          | 600 s   |
| Convergence reviews (normalization, canonical, lifecycle, routes) | 300 s   |
| Document freshness generation, assessment, and cross-check        | 300 s   |
| Repository change review                                          | 300 s   |
| Owner-turn assessment and practice                                | 120 s   |

A resident's provider quantum allows one convergence, freshness, owner-turn, or practice call per cycle, and change review takes one job per cycle. So each row bounds one stage, not the whole cycle.

The Mac case is not explained by this. Every Mac resident in `~/Library/Logs/Lervo/knowledge-host.log` reported `waiting_owner`: the Mac does not own convergence, so its residents make only owner-turn and practice calls. Their read-only debt inspection, the `scan` scope in that log, usually took 30 to 140 seconds. The log has no timestamps, so the stage that held the Mac for 415 seconds could not be identified.

## Decision

### Before a call: no call starts while an upgrade waits

Each background provider call that a resident cycle makes asks `yieldToUpgrade`, which is the resident's `FullCycleAdmission.preempted()`, before it reserves budget. If an upgrade waits, the call does not start, no budget is reserved, and the provider quantum is unchanged. The call defers with `knowledge_capacity_unavailable`. This covers three paths:

- `withKnowledgeProviderAdmission`, which runs normalization generation and every convergence review.
- `generateFreshnessProposal`, which runs freshness generation, assessment, and cross-check.
- `governChangeReviewCalls`, which runs repository change review.

### During a call: the call is abandoned

While the call runs, the caller asks `yieldToUpgrade` once per second. When an upgrade waits, the caller aborts the call's own signal. The provider process is cancelled and its answer is discarded. Only the provider call listens to that signal. The cycle signal, the stage, and every durable write are untouched.

The watch stops before the caller's exact fence. In convergence, it stops when `endPolling` stops the source poll. So an abort never lands after a write has started. An answer that arrived before the abort is used as usual.

Each path defers on the existing code `knowledge_capacity_unavailable`:

- **Convergence.** The stage settles as `waiting_authority`, the same path a spent provider quantum takes. No stage attempt is counted. The stall clears once provider admission is not paused or full and no live work runs, so the next cycle after the upgrade runs the stage again.
- **Freshness.** The call returns `deferred` with `attempted: true`, and its usage is recorded as unavailable. Candidate generation and assessment stay pending. A cross-check settles as `unavailable`, charged at the remaining bound, as any attempted cross-check call that fails.
- **Change review.** The governor records the call with `knowledge_provider_call_failed` and throws `knowledge_capacity_unavailable`. The job worker reschedules the job as a transient failure. That spends one of its 16 attempts and waits out its backoff.

The reserved call stays counted against its batch budget, because the cancelled process may have spent tokens.

### Who asks

Only a resident cycle passes `yieldToUpgrade` to these contexts, from the admission it holds. One-shot workers and CLI commands hold no full-cycle admission and keep their behavior. An unreadable admission database answers "no upgrade waiting", as `preempted()` already does, so the call continues and the 15-minute backstop still bounds the upgrade's wait.

Owner-turn assessment and practice calls are not abandoned. Each has a 120-second timeout and runs at most once per cycle, which is inside the target.

### Rejected: release admission for the duration of the call

The resident could release admission while its provider call runs and take it back before it writes. An upgrade would then run while a stage holds a partial result, and that result would have to pass a new exact fence after the upgrade changed the repository. It would also weaken the ADR-0484 exclusion that the upgrade confirms before each stage under ADR-0577. Abandoning the call keeps that exclusion and costs at most one provider call per upgrade on the host.

## States, privacy, and failure meaning

No event, field, failure code, file, or column is added.

- `knowledge_capacity_unavailable` on a convergence stage, a freshness deferral, or a change-review retry now also means that an upgrade was waiting for the host's full-cycle admission. Before, it meant only that the provider quantum or host provider admission was spent. In each case the work is still due and nothing failed.
- The abandoned call's usage record carries no answer and the usual unavailable usage. No prompt, source text, or answer is retained beyond what a failed call already retains.
- Resident health is unchanged. The cycle still stops at its next boundary with `busy` and `knowledge_cycle_yielded_to_upgrade`.

## Consequences

An upgrade that arrives during a background provider call now waits about one second for that call, plus the stage's settlement and the next boundary check. Estimated, not measured: the WSL `lervo` wait on v0.25.4 would have dropped from 703 seconds to the settlement and discovery after the call, under a minute. The longest remaining stages are not provider calls. On WSL `lervo`, ADR-0580 measured freshness lint at 46 seconds and convergence discovery at 52 to 56 seconds of CPU per cycle. The owner-turn assessment and practice calls take up to 120 seconds. The expected worst-case wait is therefore about 2 minutes. A Mac non-owner's debt inspection under heavy host load can still take longer.

Each abandoned call costs the tokens it spent before cancellation. Upgrades are rare, and one host abandons at most one call per upgrade: only one resident holds admission, and every later call in its cycle checks before it starts. A change review spends one retry attempt each time. A freshness cross-check abandoned this way settles without its cross-check.

The gap between the two rounds of one repository's upgrade remains. A resident can still start a cycle there, and the next round waits for its current non-provider stage.

## Verification

- `upgrade-preemption.test.ts`: the watch aborts within one poll once an upgrade waits; no abort lands after the watch stops, even from a check in flight; an unreadable answer or a one-shot context means no upgrade waits. On origin/main, the module does not exist.
- `provider-call-abort.test.ts`: a convergence review whose provider call would run for 10 minutes is cancelled within one second of an upgrade starting to wait. It rejects with `knowledge_capacity_unavailable`, writes no observation artifact, and releases provider admission. With an upgrade already waiting, `withKnowledgeProviderAdmission` reserves no budget, starts no call, and leaves the provider quantum unchanged. On origin/main, the call runs on and the budget is reserved.
- `upgrade-preemption-review-calls.test.ts`: a freshness call is cancelled and returns `deferred` with `knowledge_capacity_unavailable` and `attempted: true`, with its usage recorded once; with an upgrade already waiting, it starts nothing. A change review call is cancelled, recorded with `knowledge_provider_call_failed`, and rejects with `knowledge_capacity_unavailable`; with an upgrade already waiting, it reserves nothing. On origin/main, these calls ignore the waiting upgrade.

Installed verification: after the release that carries this change, record the `waitMs` of WSL `lervo` and Mac `axli` from the next follower pass in the [release-to-fleet roadmap](../../roadmap/operations/release-to-fleet.md).
