# ADR-0482: Absorb squash-merged semantic candidates and type verification source changes

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0449](../repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md) and [ADR-0472](../documents/0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)
Amended by: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) (settled preimage stalls are reevaluated once), [ADR-0521](0521-judge-convergence-verification-on-the-bytes-git-keeps.md) (verification is judged on the bytes Git keeps)

## Context

After ADR-0479 deployed on 2026-10-06, two WSL repositories still stopped for reasons no owner decision could prevent from recurring:

- **shiflo** recorded `waiting_authority/canonical_target_diverged` at `canonical_integration`. Its integration ref, `refs/heads/lervo/knowledge-integration` (`e5870e29`), carried 15 commits: owner support commit `873f282f` and 14 Lervo knowledge commits. The owner squash-merged reconciled work into `main` through PR #47 (`acd38901`), following the repository's convention for every PR. Of 23 ref-only paths, 6 were byte-equal to `HEAD`, 15 were rewritten by the squash commit, and 2 Lervo-only documents were omitted. ADR-0449 synchronizes only when every ref-only change is an integrated draft, so the ref could never catch up and would diverge after every squash merge.
- **flemo** recorded `attention_required/knowledge_stage_failure_unclassified` after four `repository_changed_during_verification` assignment failures. Its `gate` suite (`bunx turbo run typecheck lint test build`) rewrote tracked `pnpm-lock.yaml` in the isolated workspace six seconds into each run, adding `@pnpm/exe@12.9.1` to `packageManagerDependencies`. The same change is uncommitted in the owner checkout. The untyped code hid the exact path and remedy.

## Decision

### Squash absorption

Before recording `canonical_target_diverged`, integration preflight compares the integration ref with `HEAD` using:

- The merge base.
- Ref-only paths: `merge-base..ref`.
- Base-side changed paths: `merge-base..HEAD`.
- The committer of each ref-only commit.

Absorb the ref only when every ref-only path satisfies one of these cases:

- It is byte-equal at `HEAD`, or a base-side commit changed it. Either means the merged change decided it.
- Only `knowledge@lervo.invalid` committed it, and the base never adopted it. Treat it as a dropped Lervo proposal; normal normalization and assessment re-propose it if still warranted.

At least one ref-only path must be decided by a base-side commit. Any other ref-only path is real divergence and retains `canonical_target_diverged`, including owner bytes the base never received and Lervo work the base has not decided at all.

On absorption, the owner:

- Preserves the old tip as `refs/lervo/knowledge-integration-absorbed/<old-tip>`, retaining the newest eight such refs.
- Moves the Lervo-only ref to `HEAD` with a compare-and-swap.
- Records `knowledge.integration_target.absorbed`.

Absorption never touches the working tree, `HEAD`, or any user branch. A stopped `canonical_target_preimage` dependency becomes reevaluable when absorption is detectable, allowing `shiflo` to resume without an owner command.

### Typed verification source changes

The runtime retains the first and latest repository observations for each pinned verification suite, using the convergence capture at the root and the orchestrator snapshot in isolated workspaces.

When the runner reports `repository_changed_during_verification`, the runtime computes a path-level diff between those observations. For a non-empty diff, it stores private evidence and fails the stage with `knowledge_verification_modified_sources`. This code is not retried: the first failure records `attention_required`. Owner status adds `verificationChanges: { changedPathCount, paths }`. Detection uses the snapshot diff, not path names.

## State, events, privacy, and failure meaning

The new `knowledge.integration_target.absorbed` event contains:

| Field               | Meaning                                       |
| ------------------- | --------------------------------------------- |
| `previousTarget`    | Absorbed ref tip.                             |
| `mergeBase`         | Merge base of that tip and `HEAD`.            |
| `newTarget`         | Commit the ref now names.                     |
| `absorbedPathCount` | Ref-only paths that `HEAD` decided.           |
| `droppedPathCount`  | Lervo-only paths left for re-proposal.        |
| `pathSetHash`       | Digest of the absorbed and dropped path sets. |
| `occurredAt`        | Recording time.                               |

Paths remain in Git and the backup ref; the event carries no paths. A store below event schema 4 loses only this audit line.

The new failure code `knowledge_verification_modified_sources` means a pinned verification suite changed the listed repository files while running. Its result cannot verify the reviewed bytes, and retrying repeats the change. It produces `attention_required`.

Recovery: commit the bytes the suite produces, or change the suite to leave tracked files unchanged. A changed source snapshot requeues the stage.

Evidence and status list at most 256 repository-relative paths and never file contents.

## Verification

Focused tests must demonstrate:

- A squash-merged ref moves to `HEAD`, with a backup ref and recorded event; the working tree and `main` remain unchanged.
- An owner-only ref file keeps the ref diverged.
- Unpublished Lervo work about which the base decided nothing is not absorbed.
- A changed verification snapshot yields `knowledge_verification_modified_sources` with exact paths; other runner failures retain their codes.
- The event payload satisfies its schema and carries no paths.

Installed verification must show:

- `shiflo` leaving `canonical_target_diverged` without an owner command.
- `flemo` reporting `knowledge_verification_modified_sources` with `pnpm-lock.yaml`.
