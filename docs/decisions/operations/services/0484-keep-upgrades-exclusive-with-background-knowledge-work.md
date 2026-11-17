# ADR-0484: Keep upgrades exclusive with background knowledge work

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md), [ADR-0444](../../knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)
Amended by: [ADR-0487](0487-plan-and-apply-approval-free-upgrades-in-one-exclusive-window.md) (approval-free upgrades plan inside the exclusive window), [ADR-0574](../../distribution/0574-admit-upgrades-ahead-of-background-knowledge-cycles.md) (the upgrade asks with priority; a running cycle stops at its next stage)

## Context

On WSL, `lervo upgrade --apply` for the `lervo` repository (main `ddcb2978`) failed with `knowledge_recovery_required`: "The previous knowledge materialization transaction must be recovered first." The marker `.lervo/state/knowledge/materialization-transaction/journal.json` was not interrupted: the repository's Node knowledge worker, process 3373975, owned it while recording a `knormplan_…` background normalization event in phase `event_recording`.

Durable knowledge apply writes this marker before publishing bytes and removes it after the event commits. Although `inspectKnowledgeMaterializationOwner` distinguished `live` from `interrupted` owners, foreground paths called `assertNoKnowledgeMaterializationTransaction`, which immediately refused any marker. The upgrade's knowledge stage became `blocked`, invalidating the approved plan ID, and knowledge lint threw. `lervo knowledge` subcommands, `lervo migrate knowledge`, `lervo state`, and terminal knowledge lifecycle inspection failed similarly. Busy repositories repeatedly rejected commands even when the owner would settle within seconds—the same failure class that Node upgrade fences addressed by waiting for running work.

Waiting for that marker alone was insufficient: the next upgrade failed with `source_bytes_changed`: "The repository revision changed during the scan." The resident had committed knowledge during the upgrade. The Mac and WSL repository replica and the user can also change the tree during a long upgrade. Handling isolated collisions leaves upgrades racing background writers.

## Decision

### Upgrade apply holds the resident's full-cycle admission

`lervo upgrade --apply` acquires the resident's existing full-cycle admission, `acquireFullCycleAdmission` from `@lervo/repository-knowledge-runtime`, before recreating the plan to check approval. It holds admission through the last stage and releases it on success or failure. No new lock is introduced.

- Every resident acquires admission before each full cycle, covering discovery, materialization, and the knowledge commit. No resident cycle on the host can start while the upgrade holds it. Waiting residents report health `busy` with reason `knowledge_cycle_admission_wait`.
- For an already-running cycle, the upgrade polls about once per second for at most 15 minutes and prints one stderr line: `Waiting up to 15 min for the running background knowledge cycle on this host to finish before upgrading.` If the cycle outlasts the wait, the upgrade fails with `knowledge_cycle_admission_wait_expired` and changes nothing.
- Admission is a host-wide lease with concurrency one; residents of other repositories on the host also pause for the upgrade.
- The upgrade process owns the lease and renews it every minute. Its dead PID frees the lease if the process dies.
- Node replacement and host-resident service stages stop the old resident and start a new one. The new resident waits for admission and starts its first cycle after release. No stage waits for a resident cycle, and Node readiness has no knowledge component, so holding admission cannot deadlock a stage.
- Plan-only `lervo upgrade` remains read-only and takes no admission.

Work outside a full cycle—including publication, continuity reconciliation, and materialization by another host process—remains covered by marker settlement and scan retries.

### Scans retry concurrent changes

Repository knowledge scans only read. If another writer moves `HEAD` or a file during a scan, `scanRepositoryKnowledge` retries, allowing at most three attempts. Writers include replica pulls, users, and background processes outside admission. A repository that keeps moving fails with `source_bytes_changed`. Discovery retains its separate three-attempt retry around its wider digest bracket.

### Marker classification

`describeKnowledgeMaterializationOwner` reads the marker without changing it and returns:

- `none`: no marker exists.
- `live`: another running process owns the journal; the result includes `ownerPid`, `planId`, and `phase`.
- `interrupted`: any other marker, including an unreadable journal or one owned by the calling process.

`assertNoKnowledgeMaterializationTransaction` still immediately refuses any marker with `knowledge_recovery_required`. Resident, runtime, and conversation callers retain this code and their own retry schedules. The message depends on ownership:

- `live`: names the owner process, plan, and phase and asks the caller to retry after settlement.
- `interrupted`: names the exact recovery command, `lervo knowledge materialize --recover`.

### Foreground settlement

`createKnowledgeMaterializationSettlement` provides one bounded wait budget per foreground command:

- `settle()` polls every 2 seconds while a live owner holds the marker. It returns `none` or `interrupted` and never touches the marker.
- `run(operation, refusedByMarker?)` settles first and immediately refuses an interrupted marker with the recovery command. If a new live owner refuses the operation through an error or a value recognized by `refusedByMarker`, settlement waits and retries the operation, with at most 32 attempts. Only operations that check the marker before any effect may use this retry.
- The total command budget is 15 minutes from the first live observation. Exhaustion fails with `knowledge_materialization_wait_expired`; the message names the live owner and states that its transaction was left untouched.
- Clock, sleep, wait, and poll interval are injectable. The CLI exposes them only through the `knowledgeMaterializationWait` service override for tests.

The CLI applies settlement as follows:

| Path | Behavior |
| --- | --- |
| `lervo upgrade` | Plans through `run`. During apply, each knowledge inspect-and-apply step, post-knowledge inspection, knowledge lint, and final plan use the same settlement. A stage blocked only by `knowledge_recovery_required` is planned again after the owner settles. |
| `lervo knowledge <subcommand>` | Settles before dispatch. Excludes `worker` and `convergence`, which own marker handling, and `refresh`, whose migration settles itself. |
| `lervo migrate knowledge`, `lervo knowledge refresh` | Settle before planning. |
| `lervo state status`, `prune`, and `reset` | Settle before retention or reset classifies the marker. |
| `lervo terminal status`, `lervo terminal declare` | Use the 15-minute foreground settlement for knowledge lifecycle inspection. |
| Terminal hooks and attention inspection | Wait at most 10 seconds because provider hooks have a 30-second timeout, then report the precise refusal. |

While waiting, a foreground command prints one stderr line per live owner: `Waiting up to 15 min for the live knowledge materialization owned by process <pid> (plan <plan-id>, phase <phase>) to settle.` JSON stdout remains parseable. Hooks print no notice.

## State, privacy, and failure meaning

This decision adds no event, file, or persisted state. The upgrade writes only the existing admission row containing a PID, nonce, repository path hash, and lease times.

- `knowledge_cycle_admission_wait_expired` is a new bounded failure code: a resident cycle held admission throughout the wait, and the upgrade applied nothing.
- `knowledge_materialization_wait_expired` is a new bounded failure code: a live owner still held the marker when the budget expired, and nothing changed.

The caller may retry later. Notices and failure messages contain only a process ID, plan ID, and phase—never a source path, document body, prompt, or credential.

`knowledge_recovery_required` retains its meaning. Foreground commands now report it only for interrupted markers or live markers inside hooks after their wait expires.

## Verification

Focused tests must establish:

- A live marker that settles allows the operation and prints one notice.
- A live marker that outlasts the budget fails with `knowledge_materialization_wait_expired`, names its owner, and leaves journal bytes unchanged.
- An interrupted marker immediately fails with `knowledge_recovery_required` and the recovery command, without sleeping or running the operation.
- An operation refused by a new live owner runs again after that owner settles.
- `lervo upgrade` plans and applies the same plan ID after waiting; `lervo knowledge lint` and `lervo state status` also wait.
- A resident cycle cannot acquire full-cycle admission during `lervo upgrade --apply` but can acquire it afterward.
- Apply waits for a running cycle to release admission, then completes. A cycle that outlasts the wait causes `knowledge_cycle_admission_wait_expired` and leaves the plan unchanged.
- A scan encountering one concurrent revision change returns the new revision. A scan of a continuously changing repository fails after three attempts.

Installed verification must run `lervo upgrade --apply` while that repository's resident is normalizing and observe the wait notice followed by a completed receipt, with no resident knowledge commit between the plan check and the last stage.

## References

- [Host-wide full-cycle admission](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/admission.md)
- [Runtime ownership](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/runtime-ownership.md)
- [Repository upgrade orchestration](../../../roadmap/onboarding/repository-upgrade.md)
