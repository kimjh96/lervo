# ADR-0590: Reuse verified darwin native builds for identical inputs

Status: `accepted`
Decision date: 2026-11-18
Amends: [ADR-0581](0581-build-darwin-native-files-with-one-pinned-xcode.md) (Code quality compiles the darwin files only when no verified build of identical inputs can be restored, and fallback preparation with pending intent runs on Linux when one can), [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) (the fallback preparation no longer always needs macOS), [ADR-0522](../../operations/services/0522-reuse-ci-verification-for-identical-content.md) (one more reusable component, keyed by build inputs instead of the tree)
Amended by: [ADR-0593](0593-start-the-release-matrix-after-verification-and-prepare-on-linux.md) (pull-request preparation routes too)
Related: [ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (the release matrix keeps compiling), [ADR-0572](0572-commit-cli-release-metadata-only-when-a-release-is-prepared.md) (exact metadata checks)

## Context

This repository is private, so GitHub bills its macOS minutes at ten times and its Windows minutes at two times the Linux rate, and it rounds every job up to a whole minute. From 2026-11-15 to 2026-11-18 the weighted macOS cost was:

| Job                                                          | Runs | macOS minutes | Weighted minutes |
| ------------------------------------------------------------ | ---- | ------------- | ---------------- |
| Code quality, `Native runtime artifacts`                     | 124  | 299           | 2,990            |
| CLI release preparation, `Reconcile release PR or exact tag` | 40   | 239           | 2,390            |
| CLI release matrix, macOS native and packed CLI              | n/a  | n/a           | about 1,750      |

Code quality's `native-runtime` job compiles `file-sync-darwin.node` and `cas-io-darwin.node` on every full-coverage run that does not reuse a whole build. Most pull requests do not touch the C sources or the build scripts, so they compile the same bytes again. The compile takes about 20 seconds, which GitHub bills as one macOS minute, or ten weighted minutes, per run.

After [ADR-0581](0581-build-darwin-native-files-with-one-pinned-xcode.md), a reconcile without pending release intent already runs on Linux. With pending intent it still runs on `macos-15`, because `pnpm release:prepare --apply` runs `pnpm build`, and only macOS can compile the darwin files. Between 2026-11-17 18:00 and 2026-11-18 07:10 UTC, 6 of 14 reconciles ran on macOS for about 3.3 minutes each, which is four billed minutes or 40 weighted minutes per run.

## Decision

### The build inputs

The two build scripts, `packages/filesystem-durability/scripts/build-native.mjs` and `packages/cas/scripts/build-native-artifact.mjs`, call `xcrun clang` directly with fixed arguments. The repository has no `binding.gyp`. Each script reads its C files, reads `node_api.h` from the include directory next to the running Node, and writes a manifest whose `sourceHash` hashes its own source list. Neither script reads an environment variable. The compiler, linker, and SDK come from the Xcode that `DEVELOPER_DIR` selects, and the build job checks that Xcode against the pin before compiling.

`scripts/distribution/lib/native-runtime-reuse-key.mjs` therefore keys a build by these inputs:

1. `nativeFileSyncSourceHash` and `nativeCasSourceHash`. They cover the C sources and headers that clang compiles, the build scripts with their clang arguments, and the shared contract modules that write the manifests.
2. A digest of every file under `packages/cas/native` and `packages/filesystem-durability/native`, so a new header that the source lists miss still changes the key.
3. Every field of `darwinToolchainPin` in `scripts/distribution/lib/darwin-toolchain.mjs`: runner label, developer directory, Xcode, clang, and SDK version and build.
4. The running Node's version, N-API version, and module ABI version, which decide the Node headers.

The key is the SHA-256 of these inputs as JSON, with an inputs schema version of 1. The runner image version is not an input, because a Linux job cannot know which macOS image a later job would get. The ADR-0581 probe built equal bytes on separate runners and in separate checkout paths. The daily audit below and the release matrix detect any drift that the key misses.

### The reusable artifact

After the toolchain check and the compile, Code quality's macOS `native-runtime` job runs `node scripts/distribution/native-runtime-reuse.mjs create`. On `main` it publishes artifact `lervo-native-runtime-<key>` for 30 days. Runs on any other ref still compile, but they publish nothing. The artifact holds the four native files and `reuse.json`, which records the schema version, the key, the inputs, the digest of the four files, and the producer's revision, workflow, run, attempt, and runner image. A failure to create or upload it never fails the job, because reuse is only an optimization.

Only a build on `main` supplies other runs. A run may use the artifact only if GitHub's record of the producing run qualifies:

- The run comes from `.github/workflows/code-quality.yml` in this repository with the same head repository.
- Its head branch is `main`, and its event is `push`, `schedule`, or `workflow_dispatch`.
- The latest attempt of its `Native runtime artifacts` job succeeded.

Such a run executes the workflow file that `main` holds. A pull-request run executes its branch's own workflow. A branch can therefore make its `Native runtime artifacts` job succeed and upload any bytes under a key that anyone can compute from `main`'s sources. Restore validation proves only that an artifact is internally consistent, not where it came from. A pull-request artifact is therefore never accepted, even from a successful run. [ADR-0522](../../operations/services/0522-reuse-ci-verification-for-identical-content.md) can trust successful pull-request runs because its reuse is bound to the identical tree, workflow file included. This key deliberately excludes the workflow, so it trusts only `main`. Reviewed merges to `main` and the daily audit keep the supply current. Expired artifacts, forks, other workflows, and any API failure also mean no reuse.

The lookup reads up to three pages of 100 artifacts with the key's name and tries them newest first, so the newest qualifying build wins. It reports `found`, `none`, or `unavailable`. A failed API call (`unavailable`) builds like a miss, but `find` also writes a workflow warning so that it is never mistaken for an ordinary miss.

Restoring never trusts the receipt alone. `restore` and `verify` recompute the key from the reading checkout and require it to equal the receipt's key. Then they check each manifest's `sourceHash` against the checkout, each `contentHash` against its binary, both Mach-O slices, and the digest of all four files.

### Code quality

A new Linux job, `native-runtime-reuse` (`Reuse native runtime artifacts`), runs under the same condition as the macOS build. It finds a qualifying artifact, downloads it, restores it into `packages/*/dist/native`, binds it to this run with the existing `native-runtime-transfer.mjs create`, and uploads it as this run's `native-runtime` artifact. Every one of these steps may fail without failing the job. The job sets `restored=true` only after that upload succeeds.

`native-runtime` now needs both jobs and runs unless `restored` is `true`. `release-artifacts` runs after either job. It still downloads `native-runtime` and validates the transfer against this run's revision, workflow, and run ID, so the build, the exact or generated metadata step, the shared build archive, the test shards, and the distribution checks consume the same files in the same way as before. In `exact` mode, `release:manifest:check` and `release:sbom:check` compare the real digests of the restored files with the committed metadata.

A missing, expired, or invalid artifact, a failed download or upload, and an API failure all leave `restored` unset, so macOS compiles as before. When that compile fails, `release-artifacts` does not run.

### The daily audit

A scheduled run never restores, following [ADR-0564](../../operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md). Its reuse job still looks up the artifact. Its macOS job compiles, downloads that artifact, and runs `native-runtime-reuse.mjs compare`, which reports `native_reuse_not_reproduced` unless the fresh build has the same digest. The audit therefore shows each day whether the reusable bytes still reproduce.

The audit offers its fresh build either way. A fresh build is newer than the one it was compared with, so the next lookup prefers it. On a mismatch, the job `native-runtime-quarantine` deletes the compared artifact by its ID and fails the run with `native_reuse_not_reproduced`. Only scheduled runs reach that job, and it is the only job with `actions: write`. Supply recovers without manual work, and the failed audit still asks for the input that the key misses. When the audit finds nothing to compare, because the lookup missed or failed, it writes a workflow warning instead of passing silently.

### Release preparation

The `route` job now checks out the exact source revision in full instead of only `.changes`. With pending intent it finds, downloads, and verifies a qualifying artifact. When verification succeeds, it routes the reconcile to `ubuntu-latest` and passes the producing run. Otherwise it routes to `macos-15` with the pinned Xcode, as before. Without pending intent it routes to Linux, as before. When the route job fails before deciding, for example during checkout or Node setup, the reconcile still runs (`!cancelled()`) and uses `macos-15`, which can prepare without a reusable build.

On Linux the reconcile downloads that artifact and restores it after installing dependencies and before `pnpm release:prepare`. With pending intent the restore is required: when the artifact is missing or invalid, the step fails, and nothing is built, committed, or pushed. During `pnpm build`, both build scripts keep files whose `sourceHash` matches the checkout and fail with `native_file_sync_source_changed` or `native_cas_source_changed` when it differs. The CLI build copies them as it does on macOS. Code quality's `release-artifacts` job already checks macOS-prepared metadata exactly on Linux, so the generated manifest and SBOM equal what a macOS preparation would commit.

### What still compiles

The CLI release matrix keeps its macOS `native-runtime` job. It compiles the darwin files from the exact tree for every prepared commit and for every tag run that cannot reuse a matrix run. The published release subjects come from that compile, and `release:manifest:check` on three platforms compares it with the committed metadata. A reused build that a fresh compile cannot reproduce therefore stops the release before publication. The matrix runs once per release, so reusing it would save little and would remove the last independent compile before publication.

`release-pull-request.yml` stays on macOS. It runs tooling from another revision than the tree it prepares, and it merges `main` before preparing, so the key would have to be computed after that merge. Routing it like the fallback preparation is follow-up work, verified by a release-pull-request workflow test that a prepared head restores a qualifying build on Linux. The packed CLI consumer smoke on `macos-15` needs macOS by nature.

`code-quality.yml` names `macos-15` for its native job. ADR-0581 replaced `macos-latest` there, and no workflow uses `macos-latest`.

## States, failures, and privacy

This decision adds no Lervo runtime event or persistent state. The receipt holds a commit SHA, a workflow name, run and attempt numbers, and a runner image name, and no credentials or user data. Failure codes:

- `native_reuse_source_invalid`: a native source directory holds something other than files and directories.
- `native_reuse_directory_invalid` and `native_reuse_receipt_invalid`: the downloaded artifact is not exactly `native/` and a valid `reuse.json` whose key hashes its inputs.
- `native_reuse_inputs_mismatch`: the artifact was built from other inputs than this checkout.
- `native_reuse_digest_mismatch`: the files differ from the receipt.
- `native_reuse_not_reproduced`: the daily audit's fresh build differs from the reusable bytes.

In Code quality, every failure except the audit's means a macOS compile. A failed lookup also writes a warning. In release preparation on Linux, a restore failure stops the reconcile, and the next successful `main` run retries it. After `native_reuse_not_reproduced`, the non-reproducing artifact is already deleted and the fresh build is offered. Find the input that changed, add it to the key, and raise the inputs schema version, which retires every earlier artifact.

## Consequences

A full-coverage Code quality run without a reused build replaces one macOS job, at least ten weighted minutes, with one Linux job of about one minute when the native inputs are unchanged. The window average of 2.4 billed macOS minutes per run would put the saving at about 23 weighted minutes per run. A run whose inputs changed, and the first run after an artifact expires, pays one extra Linux minute and starts the macOS job about 30 seconds later. After a native change merges, pull requests keep compiling until a build on `main` publishes the new key: a `main` push that compiles, or at the latest the next daily audit. The daily audit keeps one macOS compile per day.

A fallback reconcile with pending intent moves from about four billed macOS minutes, or 40 weighted minutes, to about two Linux minutes. The `route` job gains a full checkout and, with pending intent, a Node setup and one artifact download.

Hosted savings need observation after rollout. Rollback removes the reuse job, restores `native-runtime`'s dependency on `plan` alone, and returns the route job to routing by intent.

## Verification

`scripts/distribution/test/native-runtime-reuse.test.mjs` checks that the key is stable, changes for each kind of input, including a new header outside the source lists, and binds the pin and Node. It checks that a restore installs the exact earlier bytes, rejects changed inputs, changed files, a forged receipt, and extra or missing files without touching the package outputs, and that the audit comparison fails on different bytes. It also checks producer eligibility. Builds on `main` from each allowed event qualify. A successful pull-request run, a branch dispatch, a pull request whose head branch is called `main`, forks, other workflows, failed native jobs, and expired artifacts do not. The newest `main` build wins over older ones and over branch artifacts on earlier pages, and an API failure is reported apart from a miss.

`scripts/quality/test/code-quality-native-reuse.test.mjs` runs the real `find` step against a copied source tree and a fake `gh`, then evaluates the workflow's job and step conditions. Unchanged inputs reuse and skip macOS. A changed C file builds on macOS. No artifact, an API failure, a failed download, a failed validation, and a failed upload all build on macOS, and a failed macOS build keeps `release-artifacts` from running. A scheduled run compiles and compares, offers its build, and runs the quarantine job only after a mismatch. An audit that compared nothing writes a warning. A pull-request branch compiles but never offers its build.

`scripts/release/test/release-preparation-native-reuse.test.mjs` runs the route job's shell steps with the real lookup and validation. Unchanged inputs route pending intent to Linux. A changed C file, any cache miss, or a valid build that a pull-request branch published routes it to `macos-15`, and so does a route job that fails before deciding. It runs the reconcile's restore step: without the artifact it fails, with it the exact bytes are installed, and a tag-only reconcile restores nothing. It also checks that the release matrix still compiles. `native-file-sync-workflows.test.mjs` and `code-quality-workflow.test.mjs` pin the new job dependencies and conditions.
