# ADR-0482: Absorb squash-merged semantic candidates and type verification source changes

Status: `accepted`
Decision date: 2026-10-07
Amends: [ADR-0449](../repository/canonicalization/0449-synchronize-integration-target-with-working-branch.md) and [ADR-0472](../documents/0472-start-absent-integration-refs-and-bound-untyped-stage-failures.md)
Amended by: [ADR-0485](0485-reevaluate-settled-semantic-candidates-once-per-evaluation-contract.md) (settled preimage stalls are reevaluated once)

## Context

After ADR-0479 was deployed on 2026-10-06, two WSL repositories still stopped for reasons that no owner decision could prevent from recurring.

- **shiflo** recorded `waiting_authority/canonical_target_diverged` at `canonical_integration`. The integration ref `refs/heads/lervo/knowledge-integration` (`e5870e29`) carried 15 commits: owner support commit `873f282f` and 14 Lervo knowledge commits. The owner squash-merged a reconciled version of that work into `main` as PR #47 (`acd38901`), which is the repository's convention for every PR. Of the 23 ref-only paths, 6 were byte-equal to `HEAD`, 15 were rewritten by the squash commit, and 2 Lervo-only documents were left out. ADR-0449 synchronizes only when every ref-only change is an integrated draft, so the ref could never catch up. It will diverge again after every squash merge.
- **flemo** recorded `attention_required/knowledge_stage_failure_unclassified` after four `repository_changed_during_verification` assignment failures. The repository's `gate` suite (`bunx turbo run typecheck lint test build`) rewrote the tracked `pnpm-lock.yaml` in the isolated workspace six seconds into each run. It added `@pnpm/exe@12.9.1` to `packageManagerDependencies`. That same change sits uncommitted in the owner checkout. The untyped code hid the exact path and the remedy.

## Decision

### Squash absorption

Before recording `canonical_target_diverged`, integration preflight inspects the integration ref against `HEAD` with these Git facts:

- The merge base.
- The ref-only paths, `merge-base..ref`.
- The paths changed on the base side, `merge-base..HEAD`.
- The committer of each ref-only commit.

The ref is absorbed when every ref-only path matches one of these cases:

- It is byte-equal at `HEAD`, or a base-side commit changed it. Either way, the merged change decided it.
- Only `knowledge@lervo.invalid` committed it, and the base never adopted it. This is a dropped Lervo proposal. Normal normalization and assessment re-propose it if it is still warranted.

At least one ref-only path must be decided by a base-side commit. Any other ref-only path is real divergence and keeps `canonical_target_diverged`. Examples are owner bytes that the base never received, and Lervo work that the base has not decided at all.

When the ref is absorbed, the owner:

- keeps the old tip as `refs/lervo/knowledge-integration-absorbed/<old-tip>` and retains the newest eight such refs;
- moves the Lervo-only ref to `HEAD` with a compare-and-swap;
- records `knowledge.integration_target.absorbed`.

It never touches the working tree, `HEAD`, or any user branch. A stopped `canonical_target_preimage` dependency becomes reevaluable when absorption is detectable, so `shiflo` resumes without an owner command.

### Typed verification source changes

The runtime keeps the first and latest repository observations of each pinned verification suite. It uses the convergence capture at the root and the orchestrator snapshot in isolated workspaces. When the runner reports `repository_changed_during_verification`, the runtime takes the path-level diff of those observations. A non-empty diff is stored as private evidence, and the stage fails with `knowledge_verification_modified_sources`. This code is not retried, so it records `attention_required` on the first failure. Owner status adds `verificationChanges: { changedPathCount, paths }`. Detection comes from the snapshot diff, not from path names.

## State, events, privacy, and failure meaning

New event `knowledge.integration_target.absorbed`:

| Field               | Meaning                                       |
| ------------------- | --------------------------------------------- |
| `previousTarget`    | The absorbed ref tip.                         |
| `mergeBase`         | The merge base of that tip and `HEAD`.        |
| `newTarget`         | The commit the ref now names.                 |
| `absorbedPathCount` | Ref-only paths that `HEAD` decided.           |
| `droppedPathCount`  | Lervo-only paths left for re-proposal.        |
| `pathSetHash`       | Digest of the absorbed and dropped path sets. |
| `occurredAt`        | Recording time.                               |

Paths stay in Git and the backup ref. A store below event schema 4 loses only this audit line.

New failure code:

| Code                                      | State                | Meaning                                                                                                                                                     | Recovery                                                                                                                                     |
| ----------------------------------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `knowledge_verification_modified_sources` | `attention_required` | A pinned verification suite changed the listed repository files while it ran. Its result cannot verify the reviewed bytes, and retrying repeats the change. | Commit the bytes the suite produces, or change the suite so it leaves tracked files unchanged. A changed source snapshot requeues the stage. |

The evidence and status list at most 256 repository-relative paths and never file contents.

## Verification

Focused tests must show:

- A squash-merged ref is moved to `HEAD`, with a backup ref and a recorded event, and the working tree and `main` are unchanged.
- An owner-only ref file keeps the ref diverged.
- Unpublished Lervo work that the base decided nothing about is not absorbed.
- A changed verification snapshot yields the new code with exact paths, while other runner failures keep their codes.
- The event payload satisfies its schema and carries no paths.

Installed verification must show `shiflo` leaving `canonical_target_diverged` without an owner command. It must also show `flemo` reporting `knowledge_verification_modified_sources` with `pnpm-lock.yaml`.
