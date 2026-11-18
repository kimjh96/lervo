# Release preparation workflow evidence

## Current configuration and authority

[ADR-0496](../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) amends [ADR-0221](../decisions/release/packaging/0221-reviewed-cli-release-preparation.md). `.github/workflows/release-preparation.yml` now follows completed successful Code quality **push** runs on main, or explicit main-only dispatch. The former every-push, 120-minute whole-repository check is replaced by a 30-minute generation/handoff job. This is a source configuration change, not an observed hosted duration.

The `cli-release-preparation` group serializes effects without cancellation. The job retains actions, contents, and pull-request write permissions, full-history checkout, frozen installation, and Node 22.13.0. It contains no npm publication or staging command.

Admission validates the workflow ID, repository, exact revision, branch, event, successful conclusion, aggregate job, and current remote main. Stale or unsupported observations perform no release mutation; API failures grant no authority. With no pending intent, planning additionally requires full source CI and skips unsupported light runs before dependency installation. Source release completion uses the source parent as an explicit base, including manual retries.

## Generation and reviewed candidate

Pending release intent creates a candidate through the existing exact plan/apply generators. A candidate whose parent is the exact current source is revalidated rather than regenerated. Fresh generation verifies manifest and SBOM. Both paths run base-bound completion, require a clean worktree, and restrict the committed diff to:

- `apps/cli/package.json`
- `apps/cli/release-artifact-manifest.json`
- `apps/cli/release-sbom.cdx.json`
- `pnpm-lock.yaml`
- `.changes/current-release.md`
- `.changes/relint_*.yaml`

The fixed branch updates with an exact observed predecessor lease, including an absent-ref lease. It never uses an unconditional forced ref reset. Current-main admission is repeated before branch, PR, and dispatch effects.

The generated PR preserves all template sections and reports generation evidence. Full candidate verification remains unchecked. Only its marked Lervo-managed body block is updated; user text outside the block remains byte-identical. An existing unmarked or ambiguous body stops reconciliation instead of being overwritten. Migrating an old PR body requires explicit review of its ownership.

Code quality is explicitly dispatched with the expected candidate SHA and source base. Matching successful or active dispatches suppress duplicates; failed and cancelled attempts remain retryable. Same-repository automated PR events delegate to dispatch. Source-main success never substitutes for candidate success.

## Exact tag and platform handoff

A short `route` job on `ubuntu-latest` chooses the reconcile runner from the exact source revision. Preparing the release pull request builds the darwin native files (ADR-0564), and those bytes follow the toolchain ([ADR-0581](../decisions/release/packaging/0581-build-darwin-native-files-with-one-pinned-xcode.md)). With pending intent, the route job looks for a Code quality build on `main` with identical native inputs and validates it. When one exists, the reconcile runs on `ubuntu-latest` and restores those bytes before `pnpm build`; when none exists, it runs on `macos-15` with Xcode 26.3 selected by `DEVELOPER_DIR` and compiles them ([ADR-0590](../decisions/release/packaging/0590-reuse-verified-darwin-native-builds-for-identical-inputs.md)). A Linux reconcile with pending intent that cannot restore the build fails before generating anything. When the route job itself fails, the reconcile runs on `macos-15`. With no pending intent the reconcile job only admits current main and creates the tag, so it runs on `ubuntu-latest`. On 2026-11-17 the macOS queue cancelled the v0.25.2 tag job four times after 15 minutes without a runner; tag creation no longer waits for that queue.

With no pending intent, tag creation independently requires full successful CI for the exact current main: four test shards, manifest/SBOM, distribution checks, and aggregate success. A documentation-only success cannot authorize a tag. The existing tag owner still validates its exact metadata and approval plan, creates or replays the annotated tag, and dispatches the unchanged three-platform matrix when no matching run exists.

Candidate success cannot substitute for merged-main success. Tag planning or preparation alone does not establish packed-consumer, signed-attestation, deployment, npm publication, or hosted acceptance.

## Evidence boundary

[Local implementation evidence](../evidence/quality/ci-cost-and-duration-implementation.md) records the observed checks. [The CI roadmap](../roadmap/operations/ci-cost-and-duration.md) keeps hosted rollout and seven-day lifecycle-cost acceptance separate. No redesigned workflow was dispatched, tag created, or package published during local implementation.
