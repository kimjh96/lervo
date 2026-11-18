# ADR-0581: Build darwin native files with one pinned Xcode

Status: `accepted`
Decision date: 2026-11-17
Amended by: [ADR-0590](0590-reuse-verified-darwin-native-builds-for-identical-inputs.md) (Code quality and the fallback preparation restore a verified build of identical native inputs instead of compiling)
Amends: [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (preparation runs on `macos-15` with Xcode 26.3 instead of `macos-latest`), [ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (the macOS jobs of the release matrix run on `macos-15`, and reuse requires `Packed CLI (macos-15)`), [ADR-0572](0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md) (the committed native digests now name one toolchain)
Related: [ADR-0086](0086-canonical-cli-release-artifact-manifest.md) (the manifest records each packaged file's digest)

## Context

The CLI package ships two universal darwin binaries, `dist/native/file-sync-darwin.node` and `dist/native/cas-io-darwin.node`. `packages/filesystem-durability/scripts/build-native.mjs` and `packages/cas/scripts/build-native-artifact.mjs` compile them with `xcrun clang`. The committed release manifest records their exact digests. Code quality, release preparation, the release-in-pull-request workflow, and the CLI release matrix each build them on a GitHub-hosted macOS runner, and all four used `macos-latest`.

`macos-latest` now resolves to the `macos-26-arm64` image. From about 14:35 UTC on 2026-11-17, every `macos-latest` job stayed queued until GitHub cancelled it after 15 minutes without a runner. This blocked the Code quality job `Native runtime artifacts`, the release-preparation reconcile, and the macOS jobs of the CLI release matrix. Actions minutes were not exhausted, and GitHub status was green. A probe workflow showed the cause: a `macos-15` job got a runner within seconds, while `macos-latest`, `macos-26`, and `macos-26-arm64` stayed queued.

Moving the jobs to `macos-15` alone would change the release bytes. The compiler, linker, and SDK come from the image's default Xcode, and the two images default to different Xcode versions. The 0.25.2 metadata on `main` was built on `macos-26` during the release preparation of pull request 269. A `macos-15` build with its default Xcode 16.4 gives other digests:

| Build                                | `file-sync-darwin.node` | `cas-io-darwin.node` |
| ------------------------------------ | ----------------------- | -------------------- |
| Committed 0.25.2 metadata (macos-26) | `72f477a8…`             | `9a06065a…`          |
| macos-15, default Xcode 16.4         | `91c959a3…`             | `48676489…`          |

So the digests depend on which image a job happens to get. Because of that dependency, a shortage in one image pool can block both CI and releases.

## Decision

### One toolchain for every recorded build

Every job that compiles darwin native files whose bytes a release records selects Xcode 26.3 explicitly:

- Code quality `native-runtime` (`.github/workflows/code-quality.yml`);
- CLI release matrix `native-runtime` (`.github/workflows/cli-release-matrix.yml`);
- release in pull request `prepare` (`.github/workflows/release-pull-request.yml`);
- release preparation `reconcile` when pending intent routes it to macOS (`.github/workflows/release-preparation.yml`).

Each job sets `DEVELOPER_DIR=/Applications/Xcode_26.3.app/Contents/Developer` and runs on `macos-15`. The release-preparation `route` job writes `runner=macos-15` for pending intent and keeps `ubuntu-latest` for a tag-only reconcile. The `Packed CLI` matrix leg for macOS also moves to `macos-15`. It restores the native artifact instead of compiling it, so it needs no Xcode selection. No workflow follows `macos-latest` anymore.

Xcode 26.3 is installed on both `macos-15` and `macos-26`. It is the newest version on both images. The default Xcode 16.4 of `macos-15` is not on `macos-26`. With the pin, a job can move to `macos-26` without changing the bytes once that pool recovers, and when `macos-15` retires.

### Checking the toolchain before compiling

`scripts/distribution/lib/darwin-toolchain.mjs` holds the pin: the runner label, the developer directory, the `xcodebuild -version` line, the `xcrun clang --version` line, and the macOS SDK version and build. Before compiling, each job runs `scripts/distribution/check-darwin-toolchain.mjs`. The command reads the same five values from the runner and prints a JSON record with schema version 1, `status` (`pinned` or `mismatch`), the mismatched fields, the pin, and the observed values. It also writes one summary line to the job summary. When any value differs, or a query fails because the Xcode or SDK is missing, it exits non-zero with `darwin_toolchain_mismatch: <fields>`. So the job fails before the build instead of producing other bytes.

The check is a separate workflow step rather than code in the build scripts. Those scripts are released tooling, and `release-intent-check.mjs` requires release intent for every edit to them. They are also inputs to the native source hash. The toolchain is a property of the CI job, so the job checks it. A local `pnpm build` on a Mac with another Xcode still compiles for development. Its bytes can differ from the committed manifest, and an `exact` metadata check reports that difference.

The build adds no reproducibility flags. Neither build passes `-g`, so the binaries hold no debug paths, and `ZERO_AR_DATE` applies only to static archives. The probe below built each binary in two checkout paths and got the same bytes.

### Byte identity evidence

Probe workflow `probe-macos-toolchain` (run 44134595822) built both binaries with Node 22.13.0. Each job ran on its own runner of image `macos-15-arm64` version 20261104.0514. It built in the checkout and again in a copy under another directory, and both paths gave the same digests in every job.

| Xcode (clang)            | SDK          | Runners | `file-sync-darwin.node` | `cas-io-darwin.node` |
| ------------------------ | ------------ | ------- | ----------------------- | -------------------- |
| 16.4 (clang-1700.0.13.5) | 15.5 (24F74) | 2       | `91c959a3…`             | `48676489…`          |
| 26.2 (clang-1700.6.3.2)  | 26.2 (25C57) | 1       | `9017e1a7…`             | `ea014fc6…`          |
| 26.3 (clang-1700.6.4.2)  | 26.2 (25C58) | 2       | `9017e1a7…`             | `ea014fc6…`          |

The full digests for the pin are `sha256:9017e1a758e7b22b87a9014ccdf27768cc8deacd32907ac8c93b89c44c291941` and `sha256:ea014fc6a87e2ebad6077d590396b8bd061ace6d732c243202645cd755f51c7a`. Xcode 16.4 reproduced the earlier `macos-15` digests. The same run queued four `macos-26` jobs, with Xcode 26.3, 26.2, and the image default. None of them got a runner, so identity across the two images is not proven. A `macos-26` job may build these files only after a probe shows the same digests there.

### Moving the metadata to the pinned bytes

The committed manifest and SBOM on `main` record the `macos-26` bytes of 0.25.2. Version 0.25.2 has no tag, so every Code quality run on `main` and on this change runs in `exact` mode (ADR-0572). The pinned build therefore fails `release:manifest:check` until the metadata records its bytes.

The existing `exact` failure path already produces the fix. The build job regenerates both files from its own build, uploads them as `lervo-cli-release-metadata`, and still fails. This change commits the files from a Code quality run of its own head. Its later runs are `exact` against the same bytes and pass. No Mac and no hand-built native file is involved.

This change edits no bundled source and no released tooling, so it needs no release intent. The CLI version stays 0.25.2. After the merge:

1. Code quality on `main` checks the pinned metadata in `exact` mode, or reuses the pull request's `exact` build of the same tree.
2. Release preparation finds no pending intent, routes the reconcile job to Linux, admits the successful `exact` run, and creates `v0.25.2` on the merged commit.
3. The tag's CLI release matrix builds on `macos-15` with the pin. A successful dispatched matrix run for the same tree can be reused instead (ADR-0569). `cli-release-subjects.mjs verify` then compares the published subjects with the tag's committed metadata.

The pull request 269 candidate matrix run (44100830964) bound subjects to the earlier tree. Publication requires the tag's tree, so those subjects can never be published for the new tag.

Version 0.25.3 is not used for this. A new version would need release intent for a change that alters no source or behavior, and a second preparation on a macOS runner. The 0.25.2 notes stay accurate because only compiler output changes. The tag records the bytes that were verified.

### Changing the pin later

A new Xcode changes the native bytes. To change it, update the pin, the four `DEVELOPER_DIR` values, and the runner label in one change. Then commit the metadata that the change's first `exact` run uploads. `scripts/distribution/test/native-file-sync-workflows.test.mjs` fails when a workflow disagrees with the pin. When a runner image drops the pinned Xcode, the check fails before compiling, and that same procedure applies.

### Waiting for a release matrix that never got a runner

`wait-release.sh tag` used to report a matrix run as failed when GitHub cancelled its jobs for lack of a runner. It now reruns that run's failed and cancelled jobs with `gh run rerun --failed` when every cancelled job has no runner name and no steps. It does this at most `WAIT_RELEASE_RERUNS` times (default 3). Any other cancellation still fails the wait.

## States, failures, and privacy

The toolchain record is printed to the job log and is not stored. It contains the runner's Xcode path, version strings, and SDK versions, and no credentials or user data. Failure codes:

- `darwin_toolchain_mismatch`: the selected Xcode, clang, or SDK differs from the pin, or is missing. Nothing is compiled. Install or select the pinned Xcode, or change the pin as described above.
- `release_artifact_mismatch`: unchanged meaning. During this transition, it means the committed metadata still records the unpinned bytes.

This decision adds no Lervo runtime event and no persistent state.

## Consequences

CI and releases no longer depend on the `macos-latest` pool or on its default Xcode. A macOS image or Xcode update can no longer change the release bytes without a commit. When `macos-15` lacks capacity, jobs still wait. Moving them to `macos-26` with the same pin first needs a probe that shows equal digests there. GitHub will eventually retire `macos-15` and remove Xcode 26.3, and each of those events needs a pin change with regenerated metadata.

Matrix runs from before this change named their macOS job `Packed CLI (macos-latest)`, so a tag cannot reuse them. A tag on a tree that only an older run verified builds again, which is the safe direction.

Rollback restores `macos-latest` and removes the check step. The committed metadata then needs one regeneration from the new build.

## Verification

`darwin-toolchain.test.mjs` checks that the pinned values pass and that each differing or missing field is reported. `native-file-sync-workflows.test.mjs` checks that all four building jobs set the pinned `DEVELOPER_DIR`, run the check before the build, and use the pinned runner. It also checks that no job uses `macos-latest`. `code-quality-workflow.test.mjs`, `cli-release-matrix.test.mjs`, `release-pull-request-workflow.test.mjs`, and `cli-release-matrix-reuse.test.mjs` pin the new labels and job names. `deploy-release-wait.test.mjs` checks that only a run whose cancelled jobs never started is rerun, and only up to the bound. The hosted byte evidence is the probe run above. The tag run of 0.25.2 is the first release built with the pin.
