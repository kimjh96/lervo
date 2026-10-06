# ADR-0484: Keep upgrades exclusive with background knowledge work

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0214](0214-bounded-repository-upgrade-orchestration.md), [ADR-0444](../../knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)

## Context

On the WSL host, `lervo upgrade --apply` for the `lervo` repository (main `ddcb2978`) failed with `knowledge_recovery_required`: "The previous knowledge materialization transaction must be recovered first." The marker `.lervo/state/knowledge/materialization-transaction/journal.json` was not interrupted. Its owner was the repository's own Node knowledge worker, process 3373975, which was recording the event for a `knormplan_…` background normalization (phase `event_recording`).

A durable knowledge apply writes this marker before it publishes bytes and removes it after the event commits. `inspectKnowledgeMaterializationOwner` already told a `live` owner from an `interrupted` one. Foreground paths ignored that distinction. They called `assertNoKnowledgeMaterializationTransaction`, which refused any marker at once. In the upgrade, the knowledge stage was planned as `blocked`, so the approved plan ID no longer matched, and the knowledge lint step threw. `lervo knowledge` subcommands, `lervo migrate knowledge`, `lervo state`, and terminal knowledge lifecycle inspection failed in the same way. A busy repository therefore failed these commands repeatedly, although its owner would settle within seconds. This is the same class of failure that the Node upgrade fences had before they learned to wait for running work.

Waiting out that one marker was not enough. After the wait, the same upgrade failed with `source_bytes_changed`: "The repository revision changed during the scan." The resident had made a knowledge commit in the middle of the upgrade. The Mac and WSL repository replica, and the user, can also change the tree during a long upgrade. Handling one collision type at a time leaves the upgrade racing every background writer.

## Decision

### Upgrade apply holds the resident's full-cycle admission

`lervo upgrade --apply` acquires the background resident's own full-cycle admission (`acquireFullCycleAdmission` from `@lervo/repository-knowledge-runtime`) before it recreates the plan to check the approval. It holds the admission until the last stage ends, whether the apply succeeds or fails, and then releases it. No new lock is introduced:

- Each resident takes this admission before every full cycle. That cycle covers discovery, materialization, and the knowledge commit. While the upgrade holds it, no resident cycle on the host can start. A resident that is waiting reports health `busy` with reason `knowledge_cycle_admission_wait`.
- When a cycle is already running, the upgrade waits for it to finish. It polls about once per second for at most 15 minutes and prints one stderr line: `Waiting up to 15 min for the running background knowledge cycle on this host to finish before upgrading.` If the cycle does not finish in time, the upgrade fails with `knowledge_cycle_admission_wait_expired` and changes nothing.
- The admission is a host-wide lease with concurrency one, so residents of other repositories on the same host also pause for the length of the upgrade.
- The lease belongs to the upgrade process and renews every minute. If the process dies, its dead PID frees the lease.
- The Node replacement and host-resident service stages stop the old resident and start a new one. The new resident waits on the admission and starts its first cycle after the release. No stage waits for a resident cycle, and Node readiness has no knowledge component, so holding the admission cannot deadlock a stage.
- Plan-only `lervo upgrade` stays read-only and takes no admission.

Background work outside a full cycle, such as publication, continuity reconciliation, and a materialization by another host process, is still covered by the marker settlement below and by scan retries.

### Scans retry concurrent changes

A repository knowledge scan only reads. When another writer moves `HEAD` or a file during a scan, `scanRepositoryKnowledge` scans again, with at most three attempts. Such writers include a replica pull, the user, or a background process outside the admission. A repository that keeps moving still fails with `source_bytes_changed`. Discovery keeps its own three-attempt retry around its wider digest bracket.

### Marker classification

`describeKnowledgeMaterializationOwner` reads the marker without changing it. It returns one of three results:

- `none`: no marker exists.
- `live`: the journal's owner is another running process. The result names `ownerPid`, `planId`, and `phase`.
- `interrupted`: any other marker, including an unreadable journal or one owned by the calling process.

`assertNoKnowledgeMaterializationTransaction` still refuses any marker immediately with `knowledge_recovery_required`. Resident, runtime, and conversation callers keep this code and their own retry schedules. The message now depends on the owner:

- A `live` marker names the owner process, plan, and phase, and asks the caller to retry after it settles.
- An `interrupted` marker names the exact recovery command, `lervo knowledge materialize --recover`.

### Foreground settlement

`createKnowledgeMaterializationSettlement` gives one foreground command one bounded wait budget:

- `settle()` polls every 2 seconds while a live owner holds the marker. It returns `none` or `interrupted` and never touches the marker.
- `run(operation, refusedByMarker?)` settles first. An interrupted marker refuses immediately with the recovery command. If a new live owner refuses the operation, by error or by a value that `refusedByMarker` recognizes, the settlement waits and runs it again. At most 32 attempts are made. Only operations that check the marker before any effect may run this way.
- The budget is 15 minutes in total for the command, counted from the first live observation. When it is spent, the command fails with `knowledge_materialization_wait_expired`. The message names the live owner and says that its transaction was left untouched.
- The clock, sleep, wait, and poll interval are injectable. The CLI exposes them only through the `knowledgeMaterializationWait` service override for tests.

The CLI applies the settlement as follows:

| Path                                                 | Behavior                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lervo upgrade`                                      | Plans through `run`. During apply, each knowledge inspect-and-apply step, the post-knowledge inspection, knowledge lint, and the final plan run through the same settlement. A stage blocked only by `knowledge_recovery_required` is planned again after the owner settles. |
| `lervo knowledge <subcommand>`                       | Settles before dispatch. `worker` and `convergence` are excluded because they own marker handling. `refresh` is excluded because migration settles itself.                                                                                                                   |
| `lervo migrate knowledge`, `lervo knowledge refresh` | Settle before planning.                                                                                                                                                                                                                                                      |
| `lervo state status`, `prune`, and `reset`           | Settle before retention or reset classifies the marker.                                                                                                                                                                                                                      |
| `lervo terminal status`, `lervo terminal declare`    | Use the 15-minute foreground settlement for knowledge lifecycle inspection.                                                                                                                                                                                                  |
| Terminal hooks and attention inspection              | Wait at most 10 seconds, because provider hooks run under a 30-second timeout. Then they report the precise refusal.                                                                                                                                                         |

While waiting, a foreground command prints one line to stderr for each live owner: `Waiting up to 15 min for the live knowledge materialization owned by process <pid> (plan <plan-id>, phase <phase>) to settle.` JSON stdout stays parseable. Hooks print no notice.

## State, privacy, and failure meaning

This decision adds no event, file, or persisted state. The upgrade writes only the existing admission row, which holds a PID, a nonce, a repository path hash, and lease times. `knowledge_cycle_admission_wait_expired` is a new bounded failure code. It means that a resident cycle held the admission for the whole wait and that the upgrade applied nothing. `knowledge_materialization_wait_expired` is a new bounded failure code. It means that a live owner still held the marker when the budget ran out and that nothing changed. The caller may retry later. The notice and the failure message contain only a process ID, a plan ID, and a phase. They never contain a source path, document body, prompt, or credential.

`knowledge_recovery_required` keeps its meaning. A foreground command now reports it only for an interrupted marker, or for a live marker inside a hook after the hook's wait expires.

## Verification

Focused tests must show:

- A live marker that settles lets the operation run and prints one notice.
- A live marker that outlasts the budget fails with `knowledge_materialization_wait_expired`, names the owner, and leaves the journal bytes unchanged.
- An interrupted marker fails immediately with `knowledge_recovery_required` and the recovery command, without sleeping or running the operation.
- An operation that a new live owner refuses runs again after that owner settles.
- `lervo upgrade` plans and applies the same plan ID after waiting, and `lervo knowledge lint` and `lervo state status` also wait.
- A resident cycle cannot acquire the full-cycle admission while `lervo upgrade --apply` runs, and it can acquire it after the apply.
- An apply waits for a running cycle to release the admission and then completes. A cycle that outlasts the wait makes the apply fail with `knowledge_cycle_admission_wait_expired` and leaves the plan unchanged.
- A scan that sees one concurrent revision change returns the new revision, and a scan of a repository that keeps moving fails after three attempts.

Installed verification must run `lervo upgrade --apply` on a repository while its resident is normalizing. It must observe the wait notice followed by a completed receipt, with no resident knowledge commit between the plan check and the last stage.

## References

- [Host-wide full-cycle admission](../../../specs/background-knowledge-convergence/runtime/discovery-and-progress/resident-cycle/admission.md)
- [Runtime ownership](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/runtime-ownership.md)
- [Repository upgrade orchestration](../../../roadmap/onboarding/repository-upgrade.md)
