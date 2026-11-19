# ADR-0593: Start the release matrix after verification, and prepare on Linux when a verified build exists

Status: `accepted`
Decision date: 2026-11-19
Amends: [ADR-0569](0569-verify-the-release-matrix-before-merge-and-publish-its-exact-subjects.md) (Code quality, not preparation, starts the pre-merge matrix, and only after it passed), [ADR-0590](0590-reuse-verified-darwin-native-builds-for-identical-inputs.md) (the pull-request preparation routes like the fallback preparation), [ADR-0581](0581-build-darwin-native-files-with-one-pinned-xcode.md) (the pull-request preparation needs `macos-15` only when it builds without a verified build)

## Context

The repository is private, so GitHub bills macOS minutes at ten times and Windows minutes at two times the Linux rate. On 2026-11-19 the owner ruled that Actions spend is too high.

**The matrix ran on commits that never merged.** Preparation dispatched Code quality and the CLI release matrix together for each prepared commit (ADR-0569). Measured from 2026-11-18 12:00 to 2026-11-19 07:30 UTC, at billed whole minutes:

- A matrix run on a prepared feature commit costs 68 to 85 weighted minutes: macOS 4 to 5, Windows 5 to 12, Linux 8 to 11.
- A tag run that reuses it costs 14.
- Of the 10 feature-commit matrix runs, 5 belonged to preparations whose Code quality failed or that a fix replaced: 374 weighted minutes for subjects that were never published.

**Pull-request preparation still ran on macOS.** It runs on `macos-15` because `pnpm release:prepare --apply` builds the darwin native files. That is about 3 billed macOS minutes, or 30 weighted, per preparation. ADR-0590 already restores a verified build for the fallback preparation and left this workflow as follow-up work. The reason was that this workflow merges `main` before preparing, so the reuse key must describe the merged tree.

## Decision

### The matrix follows a passed verification

- **Code quality starts the matrix.** A new job, `release-matrix` (`Start the CLI release matrix for a prepared commit`), needs `verification` without `always()`, so it runs only when the aggregate passed. On a dispatched run for an exact commit whose author is `lervo-release[bot]` and whose subject is `chore(cli): prepare release`, it dispatches `cli-release-matrix.yml` for that branch and commit through `release_dispatch_once`. Other dispatches start nothing. The job has `actions: write`; a dispatch made with `GITHUB_TOKEN` starts a run.
- **Preparation starts it only after a pass.** `release_verification_dispatch` still dispatches Code quality once. It also dispatches the matrix, but only when a successful dispatched Code quality run for that commit already exists, because no new run would start it then. This covers a repeated preparation of a verified commit, and both the feature pull request and the fallback `lervo/release-cli` candidate.
- **The merge gate is unchanged.** `wait-release.sh pr` still waits for both dispatched runs of the prepared head. The tag run still reuses the matrix of the same tree.

### The pull-request preparation routes like the fallback

- **The route job.** A new Linux job, `route` (`Choose the preparation runner`), checks out the pull-request head with full history and fetches `main`. It then builds the tree the preparation will build: it drops the head's own preparation commit and merges current `main` exactly as `reconcile-release-pull-request.sh` does.
- **No build, no macOS.** A current preparation is only revalidated, a merge conflict stops before any build, and a tree without pending intent prepares nothing. In these cases the job routes to `ubuntu-latest`.
- **Restore when possible.** Otherwise it runs the merged tree's `native-runtime-reuse.mjs find`, download and verify. A verified `main` build routes to `ubuntu-latest` and passes the producing run. Anything else routes to `macos-15`, and a route job that fails before deciding leaves `macos-15`, as in ADR-0590.
- **Linux restores before preparing.** `reconcile-release-pull-request.sh` restores the build from `NATIVE_REUSE_DIRECTORY` after it merges `main` and installs, before `pnpm release:prepare`. On any system other than Darwin, a missing or invalid restore fails with `release_native_build_unavailable` before any commit or push. The restore checks the key against the checkout, so if `main` moves between the route and the preparation, the restore fails closed. The toolchain check runs only on macOS.

## Consequences

- **A failed or replaced preparation no longer pays for the matrix:** about 70 to 85 weighted minutes saved each time. A preparation that passes first time pays the same as before.
- **A preparation with unchanged native inputs runs on Linux:** about 25 weighted minutes saved each time. The route job adds about one Linux minute.
- **Slower merge:** the matrix now starts about 20 minutes later, after Code quality, so the merge of a prepared pull request waits that much longer.
- **Rollback:** revert this change; preparation then dispatches the matrix again and runs on macOS.

## Verification

- **`release-pull-request-workflow.test.mjs`:**
  - routing decisions;
  - the route job's tree step against fixture repositories: a head with intent builds; a current preparation, a stale one, `main` and a conflicting head each give the expected answer;
  - a first preparation dispatches no matrix, and a repeated preparation after a passed Code quality run dispatches it without a second Code quality run;
  - a Linux preparation refuses to prepare without a restored build, restores before planning, and revalidates a current preparation without one.
- **`code-quality-workflow.test.mjs`:** the new job's conditions and permissions; the job dispatches the matrix only for a preparation commit and only at the expected revision.
- **`native-file-sync-workflows.test.mjs`:** both preparations' runner expressions and macOS-only toolchain checks.
- **Next real release:** the first prepared pull request proves the dispatch from `GITHUB_TOKEN` and the Linux restore.
