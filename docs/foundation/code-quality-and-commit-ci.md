# Code quality and commit CI execution

## Current source contract

[ADR-0496](../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) amends the CI portion of [ADR-0470](../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md). The checked-in `.github/workflows/code-quality.yml` configures PRs, main pushes, explicit dispatch, and a daily full audit. Configuration establishes required behavior; hosted execution and savings require separate run receipts.

Every ordinary change retains frozen dependency installation, quality, commit, architecture, documentation, branding, natural-language, and base-bound release-completion checks. Only a completely observed diff of Markdown under `docs/`, excluding test and fixture directories, admits the documentation-only path. Unknown paths, missing ancestry, excessive input, packaged documentation, scripts, configuration, and release metadata select full coverage. Rename detection is disabled so both changed sides are classified. Explicit dispatch and daily audit always select full coverage.

## Shared build and full verification

All jobs use Node 22.13.0 on Ubuntu. Full coverage adds source typechecking and one artifact producer running `pnpm build`, manifest verification, and SBOM verification. The producer shares only workspace `dist` directories through a run-local archive retained for three days.

Four test shards restore the exact build after validating revision, workflow/run identity, Node version, OS, architecture, digest, allowed paths, regular-file types, and destination parents. Failed-consumer retries may reuse a successful producer from an earlier attempt of the same run; future-attempt or different-run artifacts are rejected. A rerun producer replaces its same-run artifact. Restore removes stale output files only after validation. macOS and Windows release checks build independently.

Tests retain two workers, the 30-second default deadline, a 45-minute shard timeout, and per-process temporary user-state isolation. The bounded timing profile and CI-specific sequencer change placement only. Every discovered file is assigned exactly once; new files are included. Test assertions, pool, and isolation remain intact.

Distribution checks use the same build on explicit dispatch, daily audit, and full main pushes without pending release intent. They cover unsigned attestation, built CLI/Hub/Node, standalone distributions, packed CLI, isolated registry publication fixtures, and knowledge lint. Generated release candidates receive these checks through their explicit dispatch. Ordinary PRs retain full tests and metadata checks without adding the distribution suite.

## Aggregate, events, and release effects

`CI verification (lervo-ci-v1)` always evaluates the required job results. Its versioned receipt distinguishes `full` and `documentation_only`; failed, cancelled, skipped-required, and unknown results cannot become success. Hosted required-check configuration must be reconciled with this aggregate during rollout; local source checks do not establish that branch protection was changed.

Explicit candidate dispatch binds both the expected candidate SHA and its source base. A moved branch fails planning. Same-repository `lervo/release-cli` PR events delegate to this dispatch to avoid duplicate heavy verification. A fork with the same branch name retains ordinary PR verification.

Read-only verification cancels superseded runs by workflow and ref. Release generation and tag effects remain serialized and non-cancellable. [Release preparation evidence](../distribution/release-preparation-workflow-evidence.md) defines their exact successful-current-main gates. The separate commit workflow remains unchanged; code quality also validates its exact introduced range. No last-commit fallback in the separate workflow proves validation of an unavailable full range.

## Node compatibility and evidence

Root `engines.node`, workflow Node versions, and the tilde `@types/node` range stay aligned with the supported minimum. The alignment regression test remains required. Raising the minimum requires reviewed release intent under [CLI version management](../distribution/cli-version-management.md).

See the [implementation evidence](../evidence/quality/ci-cost-and-duration-implementation.md) for local results and the [roadmap](../roadmap/operations/ci-cost-and-duration.md) for hosted acceptance. Historical narrative without matching workflow bytes or execution receipts is not operational evidence. This reference does not establish a hosted pass, publication, or observed bill reduction.
