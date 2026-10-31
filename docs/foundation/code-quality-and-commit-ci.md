# Code quality and commit CI execution

## Current source contract

[ADR-0496](../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) amends the CI portion of [ADR-0470](../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md). The checked-in `.github/workflows/code-quality.yml` configures PRs, main pushes, explicit dispatch, and a daily full audit. Configuration establishes required behavior; hosted execution and savings require separate run receipts.

Every ordinary change retains frozen dependency installation, quality, commit, architecture, documentation, branding, natural-language, and base-bound release-completion checks. Only a completely observed diff of Markdown under `docs/`, excluding test and fixture directories, admits the documentation-only path. Unknown paths, missing ancestry, excessive input, packaged documentation, scripts, configuration, and release metadata select full coverage. Rename detection is disabled so both changed sides are classified. Explicit dispatch and daily audit always select full coverage.

## Shared build and full verification

All jobs use Node 22.13.0 on Ubuntu. Full coverage adds source typechecking and one artifact producer running `pnpm build`, manifest verification, and SBOM verification. The producer shares only workspace `dist` directories through a run-local archive retained for three days.

Four test shards restore the exact build after validating revision, workflow/run identity, Node version, OS, architecture, digest, allowed paths, regular-file types, and destination parents. Failed-consumer retries may reuse a successful producer from an earlier attempt of the same run; future-attempt or different-run artifacts are rejected. A rerun producer replaces its same-run artifact. Restore removes stale output files only after validation. macOS and Windows release checks build independently.

Tests retain two workers, the 30-second default deadline, a 45-minute shard timeout, and per-process temporary user-state isolation. The bounded timing profile and CI-specific sequencer change placement only. Every discovered file is assigned exactly once; new files are included. Test assertions, pool, and isolation remain intact.

Distribution checks use the same build on explicit dispatch, daily audit, and full main pushes without pending release intent. They cover unsigned attestation, built CLI/Hub/Node, standalone distributions, packed CLI, isolated registry publication fixtures, and knowledge lint. Generated release candidates receive these checks through their explicit dispatch. Ordinary PRs retain full tests and metadata checks without adding the distribution suite.

## Source test package resolution

Local Vitest and the CI config share the root `vitest.config.ts` aliases. Source tests resolve workspace library imports to authored `src` entrypoints. A package's default `dist` export must not silently select stale JavaScript. Specific subpath aliases precede their root alias; the currently imported subpath is `@lervo/repository-knowledge/workstream`.

`pnpm repository-scripts:check`, included in `pnpm quality:check`, runs `scripts/quality/check-test-source-aliases.mjs`. This static check reads workspace manifests, the literal alias object, and tracked or untracked test files and helpers under `apps`, `packages`, and `scripts`. It parses imports, re-exports, type imports, literal dynamic imports, `require`, and Vitest mock imports without evaluating tests or importing the Vitest config. It rejects missing aliases, missing targets, aliases outside the owning package's source, and root aliases that shadow a used subpath. Nonliteral computed imports and imports inside subprocess code strings remain outside this static claim.

The phase-zero audit found 104 workspace packages and 17 missing root aliases. All 15 library packages below export only `.` through `dist/index.js`, have `src/index.ts`, and define no private `#` imports. Each now has a source alias. The two distribution-only packages remain exact-name exceptions with reasons in `scripts/quality/lib/test-source-aliases.mjs`.

| Package under `@lervo/` | Resolution and reason |
| --- | --- |
| `agent-organization` | Source; organization and deliberation contracts. |
| `application-contract` | Source; shared application types and runtime contracts. |
| `assignment-connector-conformance` | Source; connector conformance helpers. |
| `conversation-deliberation-contract` | Source; deliberation identity and state contracts. |
| `discord-gateway` | Source; gateway adapter and transport contracts. |
| `execution-reliability` | Source; reliability evaluation contracts. |
| `filesystem-durability` | Source; synchronization behavior and optional native fallback. |
| `hub-runtime` | Source; importable runtime API. Launcher subprocesses retain built binaries. |
| `identity-migration` | Source; migration planning and apply API. |
| `node-work-admission` | Source; admission storage API. |
| `organization-credential-source-file` | Source; credential file adapter. |
| `organization-deployment-contract` | Source; deployment and credential contracts. |
| `organization-deployment-sqlite` | Source; deployment storage adapter. |
| `product-surface-projection` | Source; product projections. |
| `request-grounding` | Source; request grounding contracts. |
| `cli` | Built executable or packed files; no library export or source index. |
| `node-runtime-dependencies` | Distribution dependency manifest; no source or runtime export. |

Built-artifact tests retain explicit `dist` paths, packed-consumer resolution, and subprocess launchers. Vitest aliases do not apply inside those subprocesses or external bundlers. Native distribution tests retain built modules and native artifacts; source tests can exercise the optional native fallback. Schema source imports retain `#compiled-validators` and `#coordinate-data-validation` package imports. The existing global setup verifies or generates validators as required by [ADR-0503](../decisions/execution/verification/0503-compile-schema-validators-at-build-time.md).

This closes an alias omission within the existing source-test setup. It does not amend ADR-0496's exact shared-build transfer or ADR-0503's generated-validator boundary. Static success proves alias coverage for observed literal imports; it does not prove test assertions or built artifacts passed.

## Aggregate, events, and release effects

`CI verification (lervo-ci-v1)` always evaluates the required job results. Its versioned receipt distinguishes `full` and `documentation_only`; failed, cancelled, skipped-required, and unknown results cannot become success. Hosted required-check configuration must be reconciled with this aggregate during rollout; local source checks do not establish that branch protection was changed.

Explicit candidate dispatch binds both the expected candidate SHA and its source base. A moved branch fails planning. Same-repository `lervo/release-cli` PR events delegate to this dispatch to avoid duplicate heavy verification. A fork with the same branch name retains ordinary PR verification.

Read-only verification cancels superseded runs by workflow and ref. Release generation and tag effects remain serialized and non-cancellable. [Release preparation evidence](../distribution/release-preparation-workflow-evidence.md) defines their exact successful-current-main gates. The separate commit workflow remains unchanged; code quality also validates its exact introduced range. No last-commit fallback in the separate workflow proves validation of an unavailable full range.

## Node compatibility and evidence

Root `engines.node`, workflow Node versions, and the tilde `@types/node` range stay aligned with the supported minimum. The alignment regression test remains required. Raising the minimum requires reviewed release intent under [CLI version management](../distribution/cli-version-management.md).

See the [implementation evidence](../evidence/quality/ci-cost-and-duration-implementation.md) for local results and the [roadmap](../roadmap/operations/ci-cost-and-duration.md) for hosted acceptance. Historical narrative without matching workflow bytes or execution receipts is not operational evidence. This reference does not establish a hosted pass, publication, or observed bill reduction.
