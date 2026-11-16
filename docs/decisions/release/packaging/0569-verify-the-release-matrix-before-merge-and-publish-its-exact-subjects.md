# ADR-0569: Verify the release matrix before merge and publish its exact subjects

Status: `accepted`
Decision date: 2026-11-16
Amends: [ADR-0089](0089-cli-multi-platform-release-matrix.md) (the matrix runs before merge, and a tag run can publish without rebuilding), [ADR-0221](0221-reviewed-cli-release-preparation.md) (the GitHub Release carries the verified files), [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (preparation also dispatches the matrix, and the merge waits for it)

## Context

v0.23.7 was the first release prepared inside its feature pull request ([ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md), pull request 227). GitHub run data from 2026-11-14 (UTC) gives these stages:

| Stage                                               | Window              | Minutes |
| --------------------------------------------------- | ------------------- | ------- |
| `release` label, first preparation fails, retrigger | 09:02:19 – 09:06:46 | 4.5     |
| Preparation                                         | 09:06:46 – 09:10:19 | 3.6     |
| Dispatched Code quality on the prepared head        | 09:10:14 – 09:33:20 | 23.1    |
| Merge                                               | 09:33:20 – 09:33:52 | 0.5     |
| Main Code quality, reused by tree                   | 09:33:55 – 09:35:10 | 1.3     |
| Release preparation creates the tag                 | 09:35:12 – 09:35:50 | 0.6     |
| CLI release matrix on the tag                       | 09:35:46 – 09:48:34 | 12.8    |

The GitHub Release was published at 09:48:31. That is 46.2 minutes after the label and 14.7 minutes after the merge. Inside the matrix, native artifacts took 0.3 minutes and the packed jobs ran in parallel: Windows 12.2, Ubuntu 8.8, macOS 4.1. Publishing the notes took 0.2 minutes. The matrix is 87 percent of the time after merge, and it only re-verifies a tree that existed before the merge.

The published release also carries no files. Each host builds and packs the CLI again from the tag commit ([deploy skill](../../../../.agents/skills/deploy-lervo-release/SKILL.md)). WSL hosts cannot reproduce the darwin native files, so a correct tarball has to come from CI or a Mac. This repository is private and personally owned, so `attested-cli` is always skipped and no signed provenance exists.

## Decision

### Matrix before merge

Release preparation dispatches `CLI release matrix` for the exact prepared commit, beside the existing Code quality dispatch. `release_verification_dispatch` in `scripts/release/lib/release-preparation-commit.sh` covers both, so the prepared feature pull request and the fallback `lervo/release-cli` candidate both get the matrix. Each dispatch is skipped when a successful or active dispatch for the same commit and branch exists. The matrix gains a `workflow_dispatch` input `expected_sha`. A new first job, `plan`, rejects the run when the branch no longer points at that commit.

The matrix runs in parallel with Code quality. The matrix took 12.8 minutes and Code quality 23.1, so the matrix adds no time before merge when runners are free.

### Release subjects

The Ubuntu leg of `packed-cli` keeps the files a release publishes:

1. After the manifest, SBOM, and local statement checks, `pnpm release:attestation:prepare` writes `lervo-cli-<version>.tgz`, `release-artifact-manifest.json`, and `release-sbom.cdx.json`. `cli-release-subjects.mjs bind` then adds `release-subjects.json`. That file records the version, tag, commit, tree, and each file's size and SHA-256.
2. The packed-consumer and isolated-registry smokes run.
3. `cli-release-subjects.mjs confirm` packs the same build again and requires byte-identical tarball bytes. The smokes pack their own tarball from that build, so equal bytes prove that the published tarball is the one the smokes installed.
4. The four files upload as artifact `lervo-cli-release-<tree>` with 30-day retention.

The binding names the tree, not the commit. The prepared head and the merge commit have different IDs, but `wait-release.sh pr` only passes a head that contains current `main`, so the merge has the same tree.

### Tag run

On a tag, `plan` looks for a reusable run. The lookup follows [ADR-0522](../../operations/services/0522-reuse-ci-verification-for-identical-content.md). An unexpired artifact `lervo-cli-release-<tree>` only points at a run. That run must be a completed, successful run of `.github/workflows/cli-release-matrix.yml` from this repository. Its head commit's tree must equal the tag's tree. `Native runtime artifacts` and all three `Packed CLI` jobs must have succeeded. Any API failure counts as no reuse.

With a reusable run, `native-runtime` and `packed-cli` are skipped. Without one, the tag run builds and verifies on all three platforms as before and keeps its own subjects. Either way, `github-release` downloads `lervo-cli-release-<tree>` from the chosen run and runs `cli-release-subjects.mjs verify` on the checked-out tag. Publication requires every check below:

- The binding's tag equals the pushed tag, and its tree equals the tag's tree.
- The directory holds exactly the three subjects and the binding.
- Every subject matches the binding's size and digest.
- The manifest and SBOM equal the tag's committed bytes.
- The tarball holds exactly the files that the committed manifest lists, with matching sizes and digests, and its `package.json` names `@lervo/cli` at the release version.

The last check ties the tarball to the tagged tree without trusting the run that built it. The verification runs before any install or build, so it does not load the manifest module, which imports built packages. The tag tree is already bound to that manifest, and main Code quality checked it.

`publish-github-release.sh` then creates the release with all four files in one `gh release create`, which keeps the release a draft until the uploads finish. On replay, an existing asset must be byte-identical, and an asset outside the subject set is an error. The script uploads only missing assets and never replaces a published file. Only then does it update the notes and publish, so a draft left by an interrupted creation becomes public with every subject attached.

Reuse applies only where `attested-cli` would be skipped: a private, personally owned repository, which is the current state. Where attestation applies, the tag run still builds, because that job signs its own build. Signing reused subjects is follow-up work. `attested-cli` itself is unchanged.

### Merge gate

For a prepared head, `wait-release.sh pr` also requires the newest `CLI release matrix` dispatch for that exact SHA to have succeeded. A failed matrix fails the wait even while Code quality is still running. A missing or unfinished matrix keeps it waiting. Heads without a preparation commit do not need a matrix. `wait-release.sh tag` succeeds only when the published release has exactly the tarball, manifest, SBOM, and binding as assets.

## States, failures, and privacy

The `plan` job writes `tree` and `reuse`; `reuse` is the run ID or empty. Failure codes:

| Code                                 | Meaning                                                                                       |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| `release_matrix_revision_invalid`    | `expected_sha` is not a full commit ID.                                                       |
| `release_matrix_revision_moved`      | The dispatched branch moved away from `expected_sha`; nothing is built.                       |
| `release_subjects_input_invalid`     | `bind` received an invalid version, commit, or tree.                                          |
| `release_subjects_file_set_mismatch` | The subject directory is not exactly the three subjects and the binding, or is already bound. |
| `release_subjects_binding_invalid`   | The binding is missing, too large, malformed, or has unexpected fields.                       |
| `release_subjects_tag_mismatch`      | The binding belongs to another tag.                                                           |
| `release_subjects_tree_mismatch`     | The subjects were built from another tree, for example because `main` moved before merge.     |
| `release_subjects_digest_mismatch`   | A subject differs from its binding.                                                           |
| `release_subjects_metadata_mismatch` | The manifest or SBOM differs from the tag's committed bytes, or the manifest is unreadable.   |
| `release_subjects_archive_mismatch`  | The tarball is unreadable or differs from the committed manifest.                             |
| `release_subjects_pack_unstable`     | Packing the verified build again produced different bytes.                                    |
| `release_asset_conflict`             | A published asset differs from the verified subject of the same name.                         |
| `release_asset_unexpected`           | The release has an asset outside the verified subject set.                                    |

Every verification failure stops before publication. If an upload fails partway, a rerun of the job keeps the identical assets, uploads the missing ones, and rejects any different bytes. If the artifact expires between `plan` and the download, the download fails. A rerun of the tag workflow then finds no reusable run and runs the full matrix. When `main` moves before merge, the merged tree differs. The tag run then finds no artifact for its tree and runs the full matrix. Nothing is published from another tree.

Outputs and logs carry only commit IDs, trees, run IDs, versions, file names, sizes, digests, and failure codes. The subjects are the package and metadata that the release publishes. They contain no credentials or user data. This decision adds no Lervo runtime event and no persistent state. Workflow runs, their artifacts, and the GitHub Release are the record.

## Consequences

After merge, the path becomes main reuse (1.3 minutes), tag creation (0.6), and a tag run with `plan` and `github-release` only, projected at about 1.5. Release publication should come about 3.5 minutes after merge instead of 14.7. Hosted timing needs confirmation on the first release.

Each prepared pull request now spends one matrix run before merge. A re-preparation spends another, and cancellation by ref stops the replaced one. The tag run no longer spends its 12.8 minutes when reuse applies. Pull requests prepared before this change have no matrix dispatch, so `wait-release.sh pr` waits for one. Rerunning preparation dispatches it without regenerating the commit.

Published releases now carry the exact verified tarball, manifest, SBOM, and binding. Upgrading hosts by fetching those assets instead of building is follow-up work (S4). It needs no new build path, because the assets are the matrix's own files.

Authority changes stay narrow. `plan` and `github-release` gain `actions: read` to read runs and download the artifact. `github-release` keeps `contents: write`. No workflow gains npm, tag, or status authority. Rollback restores the previous workflow: tag runs build again, and releases go back to notes only.

## Verification

`scripts/release/test/cli-release-subjects.test.mjs` covers the binding and each failure: tag, tree, file set, binding format, digest, metadata, and a consistently bound tarball whose contents differ from the manifest. It also reads a tarball produced by `pnpm pack` with long nested paths, and it rejects links, escapes, duplicates, and paths outside `package/`. `cli-release-matrix-reuse.test.mjs` checks that only a successful, same-repository, same-tree run with all four verified jobs is reused, that API failure means no reuse, that only private personal tag runs reuse, and that a moved dispatch is rejected. `publish-github-release.test.mjs` covers creation with all assets, a replay that uploads only missing assets, a conflicting asset, and an unknown asset. `cli-release-matrix.test.mjs` pins the new jobs, step order, permissions, and artifact coordinates. `deploy-release-wait.test.mjs` covers the matrix gate and the asset-complete tag wait. `release-pull-request-workflow.test.mjs` checks the exact matrix dispatch.
