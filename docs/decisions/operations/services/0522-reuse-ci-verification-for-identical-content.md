# ADR-0522: Reuse CI verification for identical content

Status: `accepted`
Decision date: 2026-10-18
Amended by: [ADR-0564](0564-prepare-the-release-inside-the-feature-pull-request.md) (the daily audit reuses nothing)
Amends: [ADR-0496](0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) (verification reuse)

## Context and authority

GitHub Actions spending reached the account's $120 limit, and jobs stopped starting. One Code quality run costs a median of 57 billed minutes across 62 runs. Four test shards take 31 of them. One change that reaches a release ran that pipeline four times: on the pull request, on main after merge, on the release candidate and on main after the release merge. The four runs verified nearly identical bytes. In the four merges before this decision, the merged main tree equaled the pull request head tree. Between the 0.22.3 source main and its candidate, only release metadata differed. The daily audit also reran everything on an unchanged main.

The owner approved reusing results for identical content on 2026-10-18 and excluded self-hosted runners.

## Decision

A run reuses a component only when an earlier Code quality run in this repository executed that component for identical content and passed. GitHub's own record establishes the earlier result: the run is completed with conclusion `success`, comes from `.github/workflows/code-quality.yml` in this repository, has the same head repository, and its latest attempt of every job for that component succeeded. A receipt artifact only points at that run. Forks, other workflows, unfinished or failed runs, failed or skipped jobs, expired receipts and any API failure mean no reuse, so the run verifies in full.

Two content digests key reuse:

- The exact Git tree, for quality checks, the build with manifest and SBOM, and distribution checks.
- A test digest, which is the tree without `.changes/`, the CLI release manifest, the CLI SBOM and the CLI package `version`. Release preparation writes only these, so a candidate keeps its source's test digest. Dependencies and every other field of the package manifest stay in the digest.

Quality checks and the build reuse together, only for the exact tree, and only with test reuse. When distribution checks are required, the build reuses only if they reuse too, because they consume this run's build. Commit-message and base-bound release-completion checks always run, because they depend on the event, not on content.

A reused job keeps its name and succeeds through one step that names the earlier run. ADR-0496's aggregate and release admission are unchanged: tag creation still requires every named job on the exact merged main run, and reuse satisfies them only by pointing at identical verified content. A candidate still builds, verifies its manifest and SBOM, and runs distribution checks, because its packaged bytes change. When it reuses tests, it reruns the release and SBOM-fact tests, which read the real release files.

The verification job publishes one receipt per component that the run executed itself: `lervo-ci-build-<tree>`, `lervo-ci-tests-<test digest>` and `lervo-ci-distribution-<tree>`. Each receipt binds contract, component, digest, revision and run ID, and is kept for 30 days. The aggregate receipt records which runs it reused. Reused components publish no new receipt, so reuse always points at a run that executed the work.

The daily audit stays scheduled. [ADR-0564](0564-prepare-the-release-inside-the-feature-pull-request.md) amends its reuse: a scheduled run reuses nothing, because reused results hid a clock-dependent test failure for six days. It costs a full run again, about 57 billed minutes instead of about ten.

## Failure and verification

`ci_content_tree_invalid` stops digest planning. Lookup failures fall back to full verification and never grant success. Tests cover digest stability across release preparation, digest changes for code and dependencies, rejected forks, other workflows, unfinished, failed and skipped runs, expired and mismatched receipts, API failure, and the reuse planning rules. Workflow tests check the reuse steps, the always-run event checks, the release-metadata tests and the receipt names.

## Consequences

An ordinary change runs its tests once. Main after merge reuses the pull request when the base did not move. A candidate reuses tests and verifies its packaged bytes, and main after the release merge reuses the candidate. Same-repository write access remains trusted, as it already is for workflow files. Hosted savings require observation after rollout. Rollback restores ADR-0496's per-revision verification.
