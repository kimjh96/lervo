# ADR-0614: Sign the verified release subjects

Status: `accepted`
Decision date: 2026-11-23
Amends: [ADR-0093](../assurance/0093-cli-release-attestation-boundary.md) (`attested-cli` signs the subjects the matrix verified, and on reuse it follows `plan` alone), [ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (every tag run may reuse a verified run)

## Context

`attested-cli` runs only where GitHub artifact attestations apply: a public repository or one an organization owns. The repository became public on 2026-11-23, so the job first ran on tag v0.34.0. It rebuilt and repacked the CLI and signed that rebuild. `pnpm pack` output is not byte-stable, so the rebuild differed from the subjects `packed-cli` had verified. `github-release` compares the attested files with the verified subjects (`compare-attested-subjects.sh`), refused with `release_subjects_attestation_mismatch`, and published nothing. ADR-0569 had recorded this case as follow-up work.

A tag run uses the workflow at its own commit, and tags are never moved, so v0.34.0 stays without a GitHub Release. The next tag carries its changes.

## Decision

`attested-cli` signs the subjects the matrix verified and never repacks the CLI. It needs `plan` and `packed-cli`, and runs under `!cancelled()` when `plan` succeeded and either a reusable run was chosen or `packed-cli` succeeded. It:

1. downloads `lervo-cli-release-<tree>` from the run `github-release` uses, `needs.plan.outputs.reuse || github.run_id`;
2. runs `cli-release-subjects.mjs verify` against the checked-out tag;
3. copies the tarball, manifest and SBOM by name into its signing directory, so a missing file fails the step;
4. builds only `@lervo/runtime-security`, which the manifest validation imports;
5. attests the copies, verifies the bundles as a consumer, authorizes the npm coordinates and uploads them, unchanged.

Because reuse no longer changes what is signed, `plan` may reuse on any tag run, and `ATTESTATION_APPLICABLE` is removed. The comparison in `github-release` stays as a guard: an attested digest that differs from the published subjects still never publishes.

On reuse, the signed provenance names the tag run that verified and signed the subjects, not the earlier same-tree run that packed them. `plan` accepts only a successful same-repository, same-workflow run of the identical tree with every verified job, and the subject verification binds every tarball file to the tagged manifest.

## Consequences

- `attested-cli` gains `actions: read`. Its signing permissions are unchanged.
- A reused tag run adds one install, one package build and the signing to `plan` and `github-release`, about three minutes in all.
- Rollback restores the rebuild. That publishes nothing in a public repository, the same failure v0.34.0 showed.

## Verification

- `cli-release-matrix.test.mjs` pins the job's condition, needs, permissions, download coordinates and step order. It requires that the job runs no `pnpm build` or `release:attestation:prepare`, and that staging names the three files.
- `native-file-sync-workflows.test.mjs` requires that `attested-cli` never restores native files or builds.
- `cli-release-matrix-reuse.test.mjs` checks that only tag runs reuse.
- A replay on the real v0.34.0 subjects from tag run 45041141098 passed `cli-release-subjects.mjs verify`. Staging left exactly the three files, and `compare-attested-subjects.sh` found them identical.
- The signing steps run only on a tag. The next tag run is their first hosted proof.
