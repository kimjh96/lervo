# ADR-0119: Stage-Only Workflow Activation Permit and Transaction

- Status: accepted
- Decision date: 2026-08-21

## Context

ADR-0117 produces a reviewable `publish-cli` job, and ADR-0118 implements its stage command. A candidate digest alone must not authorize future external writes before npm trust and GitHub protection are ready. Human review, current sources, fresh external observations, and file replacement are separate boundaries. Replacement must survive interruption without leaving an empty or unreviewed workflow.

## Decision

### Decision and permit

Workflow activation decision v1 is a canonical human document valid for at most ten minutes. It contains a `wfa_` ID, `human_operator`, exact candidate and source/output digests, and acknowledgements covering candidate review, manual-tag stage-only activation, direct-publish prohibition, separate 2FA approval, and fresh-control requirements.

`release:bootstrap:workflow-permit` requires a repository, absolute decision and new-output paths, and `--online`. It snapshots the root and CLI packages, inactive workflow, and decision; regenerates the candidate; then reads npm trust and GitHub's `npm-release` environment. It writes a mode-0600 permit v1 with `wx` only when package identity, workflow state, package access, exact `createStagedPackage` trust, a required reviewer, self-review prohibition, and exact `v*` policy are ready.

The permit binds candidate inputs/output, decision digest, normalized readiness, and observation time. It expires at the earlier of five minutes after observation or decision expiry. Its sole authority is inserting the exact `publish-cli` job into one unchanged workflow. It changes no workflow, external setting, publication, or runtime state.

### Recheck and apply

`release:bootstrap:workflow-apply` requires a repository, absolute decision and permit paths, and `--online --write`. It recomputes the candidate and permit from current sources, freshly reobserves npm and GitHub, requires the same ready report, then rechecks expiry and every source before beginning a transaction.

Plan v1 binds the before/after workflow, read-only sources, all decision/candidate/permit/readiness digests, recheck time, and strategy. External settings remain read-only, and no publication occurs.

### Transaction and recovery

The same-filesystem transaction directory is `.github/.lervo-workflow-activation-transaction`, mode 0700. It contains a mode-0600 journal, mode-preserving `workflow.next`, and renamed `workflow.original`, with files and directory entries fsynced.

The sequence is compare-and-swap validation; prepare the journal and next file; record `staged` and recheck sources; rename the current workflow to the original and record `original_moved`; rename the next file to the workflow and record `committed`; verify output and sources; then remove the transaction.

Synchronous failure before `committed` rolls back and cleans up. Interruption checkpoints require explicit `--recover`. Recovery rejects a live journal owner; rolls back `preparing`, `staged`, and `original_moved`; and retains an exact committed workflow while cleaning only its journal. Corruption, path mismatch, or unexpected bytes fail closed.

Receipt v1 records `applied`, plan/permit/readiness digests, control-recheck and apply times, the exact resulting workflow, and `stage_only_workflow_active`. It states `externalSettings=observed_not_changed` and `publication=not_attempted`; it proves neither execution nor staging or publication. Documents omit identities, reviewers, trust IDs, secrets, raw responses, and absolute paths. They are not runtime events, project state, or telemetry.

## Consequences

Candidate generation, review, external checks, write authority, and replacement remain distinct. Changed controls or sources stop processing before the first workflow write, and recovery distinguishes rollback from committed cleanup.

Fixtures cover binding and expiry, excessive npm authority, self-review, permit non-mutation, the second online observation, races, mode preservation, synchronous rollback, interrupted recovery, committed cleanup, and CLI boundaries. No production workflow or external setting was changed.

> [ADR-0120](0120-cli-stage-only-workflow-post-apply-verification.md) independently verifies the receipt, current workflow, and fresh controls.
