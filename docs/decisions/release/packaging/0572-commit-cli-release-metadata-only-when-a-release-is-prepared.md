# ADR-0572: Commit CLI release metadata only when a release is prepared

Status: `accepted`
Decision date: 2026-11-17
Amended by: [ADR-0581](0581-build-darwin-native-files-with-one-pinned-xcode.md) (the native files it commits come from one pinned Xcode), [ADR-0588](0588-generate-release-metadata-for-pull-requests-before-the-release-tag.md) (an unprepared pull request is `generated` even while the CLI version is untagged)
Amends: [ADR-0086](0086-canonical-cli-release-artifact-manifest.md) (a source change no longer requires a manifest update in the same pull request), [ADR-0092](../assurance/0092-cli-release-sbom.md) (the same for the SBOM), [ADR-0496](../../operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) (the build job checks or generates the metadata, and the shared build carries it), [ADR-0522](../../operations/services/0522-reuse-ci-verification-for-identical-content.md) (build reuse also matches how the metadata was verified)

## Context

`apps/cli/release-artifact-manifest.json` records the size and digest of every packaged file, and `apps/cli/release-sbom.cdx.json` is derived from it. Any change to bundled code, the CLI README, or the CLI's dependency graph therefore changes both files. The Code quality job `Release manifest and SBOM` required the committed files to equal the build of every pull request. A pull request that touched bundled code failed with `release_artifact_mismatch` until someone regenerated and committed both files.

Regeneration needs the darwin native files that only the macOS `native-runtime` job builds, so the files were regenerated on a Mac (pull requests 225, 227, and 231). On 2026-11-16, pull requests 255 and 256 regenerated them on WSL from the run's `native-runtime` artifact with CI's Node and pnpm versions, once bypassing the restore command's run check. Two pull requests that touch bundled code also conflict on these files, so the second to merge must regenerate again.

The files already have an owner that produces them on macOS. Release preparation ([ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) in the feature pull request, or the fallback `release-preparation.yml`) runs the build, `release:manifest:update`, and `release:sbom:update`, and commits the result with the version bump. A release proves its metadata through that commit: the dispatched Code quality run checks it exactly, the CLI release matrix checks it on three platforms, and publication compares the release subjects with the tag's committed bytes ([ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md)). Between releases nothing publishes, upgrades, or verifies from the committed files on `main`. Hosts install from the published release assets or build the tag.

Three designs were considered:

1. CI pushes a bot commit with regenerated files to each same-repository pull request. This needs a push token, a dispatched run and commit status because the token's push starts no checks, and the token cannot push workflow changes. Two pull requests would still conflict on the bot's commits.
2. CI generates the files from the build and reports them. Only a tree that a release can name must commit the exact bytes. This is chosen.
3. Stop committing the files. Publication and the tag plan read the tag's committed bytes, so this needs a new release record for no gain over option 2.

## Decision

### Two verification modes

The `plan` job of Code quality decides `releaseMetadata` with `planReleaseMetadataVerification` in `scripts/quality/lib/ci-release-metadata.mjs`:

- `exact` when the verified change edits either file. Every byte committed to these files must equal the build of the commit that introduced it, so a hand edit fails and a voluntary refresh passes.
- `exact` when the tree's CLI version has no `v<version>` tag. Such a tree is a release candidate: a prepared feature pull request, the fallback `lervo/release-cli` candidate, or `main` after a release merge and before its tag. Release preparation tags `main` only after its Code quality run succeeded, so the tag inherits this check. That includes an ordinary pull request merged between the release merge and the tag.
- `exact` when the changed paths, the version, or the tag lookup is unknown. The plan job checks out full history with tags, so a missing tag can only make the run stricter.
- `generated` otherwise. The tree's CLI version is already released, so no tag can name it under that version.

In `exact` mode the job runs `release:manifest:check` and `release:sbom:check`, as before.

In `generated` mode the job runs `release:manifest:update --committed-families` and `release:sbom:update` against the build instead. Both commands validate what they write. `--committed-families` keeps one gate of the check: an installed platform-specific package must belong to a family, prefix and version, that the committed manifest approves. Otherwise generation fails with `release_artifact_platform_dependency_unexpected`, as the check did. A new or bumped family therefore still needs an `exact` metadata edit in that pull request, which a reviewer sees. Release preparation infers families itself, so without this gate nothing would review a new family. `scripts/release/commands/report-cli-release-metadata.mjs` then writes a summary to the job log and the run summary. It lists the changed manifest sections, the packaged files whose size or digest changed, the platform package families, direct dependencies, bundled workspace packages, and portable dependencies that were added or removed, and the SBOM component counts. Reviewers keep the dependency view that ADR-0086 gave them through the committed diff. The two generated files are uploaded as artifact `lervo-cli-release-metadata` for seven days. The pull request needs no metadata commit, and an ordinary pull request no longer touches the files, so two of them cannot conflict there.

When a check or the guarded generation fails, the job runs both update commands without the family gate, as release preparation does, reports the result, uploads the files, and still fails. The report then says to commit the files. Committing them fixes the run, with no Mac and no native artifact.

### One metadata view per run

`scripts/quality/lib/ci-build-transfer.mjs` adds the two files, as the build job left them, to the shared build archive. The receipt lists them in `files`, and only these two paths are accepted. Restoring replaces the checkout's copies. In `exact` mode they equal the committed files. In `generated` mode the test shards, distribution checks, and test shadow see the metadata generated from the build they test. A run therefore verifies the same thing as before: the tree together with the release metadata of its own build. For example, `release:attestation:check` validates the SBOM against the current lockfile. A pull request that changes the CLI's production dependencies now passes without a metadata commit.

`packages/repository-knowledge-runtime/test/canonical-source-facts.test.ts` no longer assumes that the committed manifest archives the current README. Its matching case now sets the README entry from the current bytes.

### Reuse

A build receipt records the mode. The build job's first step always runs and is named `Release metadata mode: exact` or `Release metadata mode: generated`. An `exact` run publishes `lervo-ci-build-<tree>` and reuses only that name. A `generated` run publishes and reuses `lervo-ci-build-generated-<tree>`. Reuse never crosses modes, so a run that must match the committed files never skips the check because a `generated` run built the same tree. The plan job outputs the receipt name, and the aggregate job uses it.

### What a release still proves

This decision changes nothing on the release path. Release preparation regenerates both files from a macOS build and commits them. Every prepared commit carries an untagged version and edits the files, so its dispatched Code quality run is `exact`. The CLI release matrix runs `release:manifest:check` and `release:sbom:check` on Linux, macOS, and Windows for the prepared commit and for any tag run that builds. `cli-release-subjects.mjs verify` requires the published manifest and SBOM to equal the tag's committed bytes, and the tarball to equal the committed manifest. `release-tag.mjs` still requires the manifest and SBOM versions to equal the package version. Tag admission still requires a successful `Release manifest and SBOM` job on the exact `main` revision, and that revision is `exact` because its version is untagged. As a second guard, `ci-release-admission.mjs` also requires that job's `Release metadata mode: exact` step to have succeeded, and blocks with `release_ci_metadata_not_exact` otherwise. That step runs in the admitted run even when the build is reused, and an `exact` run reuses only an `exact` build.

### Readers of the committed files between releases

Between releases the committed files describe the last prepared build or the last exact refresh. They never describe an unverified one.

- `release-intent-check.mjs` reads `bundle.workspacePackages` to find bundled packages. A workspace package first bundled after the last preparation is missing from that list until the next preparation. The check therefore also seeds its closure with the current `@lervo/cli` workspace dependencies and dev dependencies. Every bundled workspace package is one of them or a runtime dependency of one. This also covers `apps/operating-client`, which the bundle inlines but the manifest never listed, because the manifest names only `packages/*` workspaces. A change to `apps/operating-client` source now needs intent.
- The repository knowledge fact `archivedReadme.matchesManifest` reports `false` after a README edit until the next preparation. That is accurate: the last prepared archive carried another README.
- Tests run locally read the committed files. CI gives them the generated files. A local run can therefore differ from CI only for a change that the next preparation will regenerate anyway.
- `pnpm check` runs `release:metadata:check` instead of the three release metadata checks. While the working tree's CLI version has no tag, it runs `release:manifest:check`, `release:sbom:check`, and `release:attestation:check`. When the version is already tagged, it skips them and prints why, so `pnpm check` passes on `main` between releases. It does not inspect edits to the files; CI does.
- The `release:manifest:check` that the deploy skill runs on the tag commit is unaffected.

### Contributor guidance

Do not regenerate or commit the two files in an ordinary pull request. Release preparation owns them, consistent with the separation of Lervo-managed and user-owned bytes. A refresh remains possible with the `lervo-cli-release-metadata` artifact of the pull request's own run. The edit makes the next run `exact`, which then verifies the refresh. The metadata files are not part of the package, so committing them does not change the build.

## States, failures, and privacy

`releaseMetadata` is a plan output with values `exact` and `generated`. Any other or missing value is handled as `exact` by the workflow conditions and by reuse. `buildReceipt` is a plan output naming the build receipt artifact. The build receipt gains `releaseMetadata`. The transferred build receipt gains `files`. Failure codes:

- `release_artifact_mismatch`: In `exact` mode, the committed manifest differs from the build. Unchanged meaning.
- `release_sbom_mismatch`: In `exact` mode, the committed SBOM differs from the manifest and lockfile. Unchanged meaning.
- `ci_build_files_invalid`: The transferred receipt lists a file outside the two metadata paths, repeats one, or omits `files`. Nothing is restored.
- `release_artifact_platform_dependency_unexpected`: In `generated` mode, the build installs a platform package family the committed manifest does not approve. Commit the uploaded files.
- `release_ci_metadata_not_exact`: Tag admission found no successful `Release metadata mode: exact` step in the run. No tag is created.
- `release_metadata_report_failed`: The committed and generated metadata could not be read or compared. The build job fails.

An ordinary pull request that leaves the files alone runs `exact` only between a release merge and its tag, or when its changes cannot be determined. For a mismatch there, wait for the tag, or commit the files from the run's `lervo-cli-release-metadata` artifact.

### A pull request verified on an older base

A pull request verified in `generated` mode on an older base can merge after a release merge whose tag does not exist yet. Before this decision the two JSON edits conflicted and blocked that merge. Now Git merges cleanly, and `main` runs `exact` because version V+1 has no tag. When the pull request changed bundled code, `main` fails with `release_artifact_mismatch`, and the tag waits until a follow-up commits the files from that run's artifact. `wait-release.sh pr` already prevents this: it judges only a head that contains current `main` and otherwise exits 3 (`stale`). After `gh pr update-branch`, the pull request runs `exact` on the new base and shows the mismatch before merge. Merge only through that wait, bound to the head it printed. A merge from the GitHub interface skips the freshness check.

The summary and the artifact contain package coordinates, packaged file paths, sizes, digests, and counts. These are the same data as the committed files. They contain no credentials or user data. This decision adds no Lervo runtime event and no persistent state.

## Consequences

Ordinary pull requests that change bundled code, the CLI README, or the CLI's dependency graph pass without a metadata commit, a Mac, or the native artifact. Two such pull requests cannot conflict on these files. Pull requests 255 and 256 no longer need their metadata commits. They should drop them once this decision is on `main`: a kept edit makes each of their runs `exact`, so it would have to match every new build of the branch.

The build job's critical path is unchanged: one generator per file replaces one check per file. A `generated` run cannot reuse an `exact` build of the same tree, which is rare. The committed metadata on `main` can lag its source between releases; each run summary replaces that inventory view, and every release commit restores an exact one.

Rollback removes the mode and restores the unconditional check. The committed files on `main` then need one refresh.

## Verification

`ci-verification-plan.test.mjs` covers released and untagged versions across events, edits to either file, merges before and after a tag, and unknown ancestry, tags, and versions. `ci-content-reuse.test.mjs` checks that reuse never crosses modes. `ci-build-transfer.test.mjs` restores generated files over committed ones and rejects invalid, repeated, missing, or unlisted files. `code-quality-workflow.test.mjs` pins the mode step, step conditions, commands, artifact, and order. `cli-release-manifest-mode.test.mjs` shows that `--committed-families` rejects a new or bumped family like the check, while preparation's plain write infers it. `cli-release-metadata-report.test.mjs` covers the report, including family and direct dependency changes. `release-intent-check.test.mjs` requires intent for a package the CLI depends on before the manifest lists it. `cli-release-metadata-scope.test.mjs` covers the local scope. `ci-release-admission.test.mjs` blocks a tag for a run without a successful exact mode step. With a README change and no regeneration, `canonical-source-facts.test.ts`, the release-intent, release-completion, and first-publication tests pass on the WSL mirror, except two first-publication tests that need a build and fail there without the change too.
