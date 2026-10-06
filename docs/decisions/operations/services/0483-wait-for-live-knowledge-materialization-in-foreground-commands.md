# ADR-0483: Wait for live knowledge materialization in foreground commands

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0444](../../knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md)

## Context

On the WSL host, `lervo upgrade --apply` for the `lervo` repository (main `ddcb2978`) failed with `knowledge_recovery_required`: "The previous knowledge materialization transaction must be recovered first." The marker `.lervo/state/knowledge/materialization-transaction/journal.json` was not interrupted. Its owner was the repository's own Node knowledge worker, process 3373975, which was recording the event for a `knormplan_…` background normalization (phase `event_recording`).

A durable knowledge apply writes this marker before it publishes bytes and removes it after the event commits. `inspectKnowledgeMaterializationOwner` already told a `live` owner from an `interrupted` one. Foreground paths ignored that distinction. They called `assertNoKnowledgeMaterializationTransaction`, which refused any marker at once. In the upgrade, the knowledge stage was planned as `blocked`, so the approved plan ID no longer matched, and the knowledge lint step threw. `lervo knowledge` subcommands, `lervo migrate knowledge`, `lervo state`, and terminal knowledge lifecycle inspection failed in the same way. A busy repository therefore failed these commands repeatedly, although its owner would settle within seconds. This is the same class of failure that the Node upgrade fences had before they learned to wait for running work.

## Decision

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

This decision adds no event, file, or persisted state. `knowledge_materialization_wait_expired` is a new bounded failure code. It means that a live owner still held the marker when the budget ran out and that nothing changed. The caller may retry later. The notice and the failure message contain only a process ID, a plan ID, and a phase. They never contain a source path, document body, prompt, or credential.

`knowledge_recovery_required` keeps its meaning. A foreground command now reports it only for an interrupted marker, or for a live marker inside a hook after the hook's wait expires.

## Verification

Focused tests must show:

- A live marker that settles lets the operation run and prints one notice.
- A live marker that outlasts the budget fails with `knowledge_materialization_wait_expired`, names the owner, and leaves the journal bytes unchanged.
- An interrupted marker fails immediately with `knowledge_recovery_required` and the recovery command, without sleeping or running the operation.
- An operation that a new live owner refuses runs again after that owner settles.
- `lervo upgrade` plans and applies the same plan ID after waiting, and `lervo knowledge lint` and `lervo state status` also wait.

Installed verification must run `lervo upgrade --apply` on a repository while its resident is normalizing and observe the notice followed by a completed receipt.

## References

- [ADR-0214](0214-bounded-repository-upgrade-orchestration.md)

- [Runtime ownership](../../../specs/background-knowledge-convergence/runtime/ownership-and-activation/runtime-ownership.md)
- [Repository upgrade orchestration](../../../roadmap/onboarding/repository-upgrade.md)
