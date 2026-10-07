# Code quality and commit CI execution

## Evidence correction

Workflow YAML, package manifests, the alignment test, and CI execution receipts were not supplied. The retained descriptions linked below are unverified source claims, preserved for reconciliation; they are neither operational guarantees nor proof of execution. This correction governs all retained descriptions, including statements phrased as facts or instructions. Coverage indicates preservation, not truth.

The supplied canonical context supports only this baseline:

- The [code convention](code-convention.md) states that `pnpm check` includes `pnpm quality:check` and that pull requests and pushes to `main` run the dedicated code-quality workflow.
- The [commit convention](commit-convention.md) requires CI validation of every introduced pull-request commit and every commit pushed to `main`. The retained last-commit fallback is unverified and does not currently qualify this policy.
- [ADR-0470](../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md) specifies pull-request and `main` artifact and test jobs on `ubuntu-latest` with Node 22.13.0. Artifact checking builds before checking the manifest and SBOM. Testing builds before `pnpm test`, using four runners, two workers each, a 30-second default test deadline, and a 45-minute timeout per shard. It also specifies per-process temporary user-state isolation. These are documented configuration requirements, not observed results.

Exact workflow bytes are required to confirm additional action pins, permissions, cancellation controls, checkout and installation settings, precise command order and arguments, the twenty-minute artifact timeout, matrix triggers, and commit-range fallback. Source-based type resolution and Node engine/type/workflow alignment require their configuration and test bytes. First-run shard durations and the `DatabaseSync.isOpen` incident require execution or incident evidence; neither outcome is established here.

No successful CI run, packed smoke, release, or publication is established.

## Retained descriptions — unverified

The prior source describes `.github/workflows/code-quality.yml` and `.github/workflows/commit-convention.yml` as supplied, although their bytes were not available for this assessment. Its descriptions are retained in:

- [Workflow controls, quality, artifacts, and tests](code-quality-and-commit-ci/workflows.md)
- [Node API baseline](code-quality-and-commit-ci/node-api-baseline.md)
- [Commit ranges and fallback](code-quality-and-commit-ci/commit-ranges.md)

Read with the conventions above and [CLI version and release management](../distribution/cli-version-management.md).

## Evidence boundary

The retained source attributes configured checks, inputs, permissions, and cancellation behavior to the workflow files. Without those files, these remain unverified. Configuration alone does not establish that a run occurred, every step executed, or quality, release completion, or commit validation passed. Historical lifecycle failure identifiers alone neither establish earlier workflow contents nor resolve missing execution evidence.
