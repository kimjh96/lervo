# ADR-0472: Start absent integration refs and bound untyped stage failures

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0449](../repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md) and [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md)
Amended by: [ADR-0482](../semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md) (verification source changes have a typed code)

## Context

On the installed Mac, the `argo` repository's convergence obligation `kconv_30003aa9af280dc16f56afd5` reached `canonical_integration` at 01:49:56 UTC on 2026-10-06 with one reviewed draft. For more than two hours, `lervo knowledge convergence status` reported `retry_scheduled` with `knowledge_job_transient_failure`. Every resident cycle returned `processed` with no outcomes.

The delegation was applied at 01:19:58 UTC and names `refs/heads/argo/knowledge-integration`. That branch had never existed in the repository. Integration-target synchronization ran `git rev-parse` on it and failed with Git exit status 128. The private stage failure proof recorded the failed command. The owner recognized only string failure codes, so this numeric exit status became `knowledge_job_transient_failure`. The delivery then followed the sixteen-attempt budget, which spans about eleven hours with backoff capped at one hour. Status exposed neither the attempt count nor the next attempt time. Earlier canonical integrations in that repository had no drafts, so they never resolved the ref.

ADR-0469 seeds delegations from a template or a peer scope. The integration ref is a host-local branch, so any newly seeded host can hit this failure.

## Decision

### Start an absent integration ref

- Synchronization first resolves the delegated ref with `git rev-parse --verify --quiet <ref>^{commit}`.
- An absent ref starts at `HEAD` through `git update-ref <ref> <HEAD> ""`. The empty old value refuses to replace a ref that another writer created first. This is the same transition as fast-forwarding a ref that `HEAD` contains. It never changes the working branch, working tree, or index.
- If the ref is still absent afterwards (for example, `HEAD` has no commit), the stage records `attention_required/knowledge_integration_target_unavailable`. The attention lasts while the delegated ref is absent. Creating the ref requeues the same stage without repeating assessment or review.

### Bound untyped stage failures

- A stage failure with an allowlisted convergence code keeps its existing meaning. A typed transient failure keeps the sixteen-attempt budget.
- Any other failure, including a numeric process exit status, is `knowledge_stage_failure_unclassified`. It retries with the same backoff for at most four attempts, about seven minutes in total.
- The fourth unclassified failure records `attention_required/knowledge_stage_failure_unclassified`. Its private dependency binds the snapshot, delegation, private failure evidence hash, and `reevaluateAt`, six hours later. A source or delegation change, or reaching `reevaluateAt`, requeues the stage.

### Show the retry schedule

When `state` is `retry_scheduled`, status includes `retry`, which holds `attemptCount`, `attemptLimit`, and `nextAttemptAt`. `attemptLimit` is `null` for a recorded failure code that the running version no longer retries.

## Failure and privacy

This decision adds no event type or state. It adds two failure codes:

| Code                                       | State                                        | Meaning                                                                     | Recovery                                                                                                                                    |
| ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_integration_target_unavailable` | `attention_required`                         | The delegated integration ref is absent and could not be started at `HEAD`. | Create the delegated ref, or change the delegation.                                                                                         |
| `knowledge_stage_failure_unclassified`     | `retry_scheduled`, then `attention_required` | A stage failed without a typed convergence code.                            | Automatic reevaluation at `reevaluateAt`, or any source or delegation change. Inspect the private failure evidence named by the dependency. |

Native messages, commands, paths, and stacks stay in private stage failure proof in the CAS. Public events and status carry only the normalized code, attempt count, limit, and timestamps.

## Verification

Focused tests must show:

- A canonical draft integrates and settles current when the delegated ref is absent at the start.
- Synchronization starts an absent ref at `HEAD` without changing the working branch or status, and reports `knowledge_integration_target_unavailable` when `HEAD` has no commit.
- A numeric exit status normalizes to `knowledge_stage_failure_unclassified`, with four attempts against sixteen for typed transient failures.
- Status for a repeated untyped failure shows each attempt and its next attempt time, then `attention_required` with private evidence and `reevaluateAt`.

Installed verification must show the `argo` obligation settling canonical integration after the upgrade, with `refs/heads/argo/knowledge-integration` created at `HEAD`.
