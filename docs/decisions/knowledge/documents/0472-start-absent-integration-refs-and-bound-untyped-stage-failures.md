# ADR-0472: Start absent integration refs and bound untyped stage failures

Status: `accepted`
Decision date: 2026-10-06
Amends: [ADR-0449](../repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md) and [ADR-0469](../../coordination/sync/0469-keep-background-knowledge-continuous-on-every-host.md)
Amended by: [ADR-0482](../semantics/0482-absorb-squash-merged-semantic-candidates-and-type-verification-source-changes.md) (verification source changes have a typed code)
Amended by: [ADR-0474](0474-name-normalization-documents-outside-the-delegation.md)

## Context

On the installed Mac, the `argo` convergence obligation `kconv_30003aa9af280dc16f56afd5` reached `canonical_integration` at 01:49:56 UTC on 2026-10-06 with one reviewed draft. For over two hours, `lervo knowledge convergence status` reported `retry_scheduled` with `knowledge_job_transient_failure`; every resident cycle returned `processed` without outcomes.

The delegation, applied at 01:19:58 UTC, named `refs/heads/argo/knowledge-integration`, a branch that had never existed. Integration-target synchronization failed at `git rev-parse` with Git exit status 128; private stage failure proof recorded the command. Because the owner recognized only string failure codes, the numeric status became `knowledge_job_transient_failure`, invoking sixteen attempts over about eleven hours with backoff capped at one hour. Status showed neither the attempt count nor the next attempt time. Earlier canonical integrations had no drafts and never resolved the ref.

ADR-0469 seeds delegations from a template or peer scope. Because the integration ref is a host-local branch, any newly seeded host can encounter this failure.

## Decision

### Start an absent integration ref

- Resolve the delegated ref with `git rev-parse --verify --quiet <ref>^{commit}`.
- Start an absent ref at `HEAD` with `git update-ref <ref> <HEAD> ""`. The empty old value prevents replacing a ref another writer created first. This is the same transition as fast-forwarding a ref that `HEAD` contains; it never changes the working branch, working tree, or index.
- If the ref remains absent, including when `HEAD` has no commit, record `attention_required/knowledge_integration_target_unavailable`. Attention lasts while the delegated ref is absent. Creating it requeues the same stage without repeating assessment or review.

### Bound untyped stage failures

- Failures with allowlisted convergence codes retain their meaning. Typed transient failures retain the sixteen-attempt budget.
- All other failures, including numeric process exit statuses, become `knowledge_stage_failure_unclassified`. They use the same backoff for at most four attempts, about seven minutes total.
- The fourth unclassified failure records `attention_required/knowledge_stage_failure_unclassified`. Its private dependency binds the snapshot, delegation, private failure evidence hash, and `reevaluateAt`, six hours later. A source or delegation change, or reaching `reevaluateAt`, requeues the stage.

### Show the retry schedule

For `state: retry_scheduled`, status includes `retry` with `attemptCount`, `attemptLimit`, and `nextAttemptAt`. `attemptLimit` is `null` when the running version no longer retries the recorded failure code.

## Failure and privacy

This decision adds no event type or state. It adds two failure codes:

| Code | State | Meaning | Recovery |
| --- | --- | --- | --- |
| `knowledge_integration_target_unavailable` | `attention_required` | The delegated integration ref is absent and could not start at `HEAD`. | Create the delegated ref or change the delegation. |
| `knowledge_stage_failure_unclassified` | `retry_scheduled`, then `attention_required` | A stage failed without a typed convergence code. | Automatic reevaluation at `reevaluateAt`, or any source or delegation change. Inspect the private failure evidence named by the dependency. |

Native messages, commands, paths, and stacks remain in private stage failure proof in the CAS. Public events and status carry only the normalized code, attempt count, limit, and timestamps.

## Verification

Focused tests must show:

- A canonical draft integrates and settles current when the delegated ref is initially absent.
- Synchronization starts an absent ref at `HEAD` without changing the working branch or status, and reports `knowledge_integration_target_unavailable` when `HEAD` has no commit.
- A numeric exit status becomes `knowledge_stage_failure_unclassified`, with four attempts versus sixteen for typed transient failures.
- Status for repeated untyped failure shows each attempt and its next attempt time, then `attention_required` with private evidence and `reevaluateAt`.

Installed verification must show the `argo` obligation settling canonical integration after the upgrade, with `refs/heads/argo/knowledge-integration` created at `HEAD`.
