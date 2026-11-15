# GitHub Actions cost and duration redesign

Status: `active`
As of: 2026-11-15
Implementation authority: owner confirmed this design with “진행” on 2026-10-08.
Task base: `7a5cce30966063861b2927be85d20be31f7e4627`.

## Outcome and scope

Give each revision one verification pipeline, share its build among consumers, and separate release generation from verification and consequential Git effects. Reduce repeated work while preserving full tests for code changes, exact release evidence, supported-platform consumer checks, and local verification without GitHub.

The owner reviewed and approved the proposed scope before implementation. [ADR-0496](../../decisions/operations/services/0496-share-exact-ci-builds-and-separate-release-generation-from-verification.md) records the accepted contracts. [Implementation evidence](../../evidence/quality/ci-cost-and-duration-implementation.md) separates local source verification from hosted acceptance.

## Observed baseline

GitHub API observations cover 662 workflow runs created from October 5 through the observed October 8, 03:10 UTC revision. These counts include skipped and unstarted runs; they are not billable-job counts.

| Observation                 | Evidence                                                                                                                                                                                                |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current ordinary CI         | Five successful six-job samples: median 21.4 minutes wall time and 81.4 runner-minutes.                                                                                                                 |
| Repeated builds             | Artifact verification and four test shards each build the same revision. Aggregate build time was 21.3–25.2 minutes per sampled run.                                                                    |
| Release preparation         | 49 completed runs with successful dependency installation used 3,225.9 runner-minutes. Failures used 872.1 minutes; cancellations used 105.8 minutes.                                                   |
| Full successful preparation | 28 runs had median duration 84.08 minutes.                                                                                                                                                              |
| Full test suite             | [Run 37706186392](https://github.com/kimjh96/lervo/actions/runs/37706186392): 1,027 files and 5,103 tests passed; test duration 3,102.02 seconds.                                                       |
| Real-time test waits        | The native-completion test file took 528.082 seconds in that run. Two lease-expiry scenarios took 187.895 and 187.555 seconds. The fixture requests a 180-second lease and waits for wall-clock expiry. |
| Dependency installation     | Approximately 12 seconds median; no active Actions caches.                                                                                                                                              |
| Platform matrix             | 148 runs, including 133 skipped runs. Ordinary pull requests already skip the packed three-platform jobs.                                                                                               |

Account-level invoices were unavailable to the current token. Payment/spending-limit rejection annotations establish some launch failures, not charges or an optimization opportunity. Earlier one-job quality runs are excluded from the current six-job baseline.

## Approved execution flow

```text
PR, main push, explicit dispatch, or scheduled audit
  -> resolve exact revision, comparison base and reuse without installing dependencies
  -> always run quality, docs, commit and release-contract checks
  -> classify verification scope conservatively
  -> for code or uncertain changes: build once
       -> manifest and SBOM validation
       -> four test shards consuming that exact build
  -> one aggregate success/failure result

successful current main
  -> cheap release eligibility and existing-candidate check
  -> generate version, notes, manifest and SBOM through their owners
  -> publish/update the reviewed candidate PR with verification pending
  -> explicitly dispatch full verification for that exact candidate

successful current main after candidate merge
  -> recheck current main, release metadata and tag plan
  -> create/replay the exact annotated tag
  -> existing three-platform packed-consumer matrix and release handoff
```

### One shared build

Keep one Linux build producer. Test shards download an artifact from their own workflow run and restore it only after checking the source revision, Node version, OS/architecture, and archive digest. Preserve required workspace output directories and executable modes. Missing, mismatched, expired, or corrupt artifacts fail the consumer; they never count as verification success.

Retain artifacts for three days. Do not upload `.git` configuration, dependency stores, credentials, user state, or runtime databases. Do not transfer Linux outputs into macOS or Windows checks. Dependency installation remains frozen in every consumer. A build cache may later improve the producer, but cannot serve as evidence that tests passed.

### Conservative scope admission

Initially admit only a narrowly defined documentation-only diff to the light path. It must contain no packaged README, runtime asset, manifest, lockfile, workflow, test fixture, script, generated release metadata, or executable configuration change. Validate complete changed-path discovery, including deletions and renames. Missing ancestry, excessive input, or an unknown path selects the full path.

The light path retains formatting, document lifecycle, branding, natural-language evaluation, commit conventions, and base-bound release completion. Keep an aggregate check running so skipped expensive jobs do not leave required checks permanently pending. Run the full suite on an explicit dispatch and a daily audit to detect classification mistakes.

Package-level affected-test selection is outside the first delivery. Dynamic subprocess and built-module dependencies must be modeled and verified before adopting it; `vitest related` alone does not prove sufficient coverage here.

### Release generation and verification

Replace expensive preparation on every main push with admission after successful verification of the current main revision. Validate the event repository, workflow identity, branch, conclusion, and exact current remote main SHA before any write. A stale or failed source performs no release mutation.

Keep the generator's current plan/apply, frozen lockfile, rollback, generated-file ownership, and changed-path checks. Remove the additional whole-repository `pnpm check` from generation. Perform generated-artifact and release-completion checks before publishing the candidate. Full tests and the remaining distribution checks belong to the candidate verification pipeline.

The candidate PR reports generation evidence and explicitly leaves full verification pending. It preserves every PR-template section and checks only items supported by observed evidence. The existing before-publication full-check contract must be amended in the same implementation; preparation success must never be presented as complete release verification.

Explicit dispatch binds the expected candidate SHA. The verifier rejects a moved branch. Automated PR events may await GitHub approval, so they cannot be the sole verification trigger. Admission and concurrency must avoid simultaneously validating the same automated candidate through PR and dispatch routes.

Do not infer candidate success from the source main's success: changing the version changes packaged bytes. Do not infer merged-main success from candidate success. Reuse is permitted only for a successful run at the exact requested SHA under the same verification contract; other revisions receive their required verification. [ADR-0522](../../decisions/operations/services/0522-reuse-ci-verification-for-identical-content.md) amends this: reuse binds to identical content instead of identical SHAs. A candidate still verifies its packaged bytes and reuses only source tests; merged main reuses only the exact tree. [ADR-0564](../../decisions/operations/services/0564-prepare-the-release-inside-the-feature-pull-request.md) moves preparation into the feature pull request, keeps the candidate as the fallback, and stops reuse in the daily audit.

Read-only verification may cancel superseded runs. Candidate ref updates and tag operations remain serialized and non-cancellable. Separate validation from effects so cancellation cannot interrupt a partially applied Git transaction. Avoid regenerating an existing candidate for the same source and intent plan.

### Tests and shard duration

Replace the two three-minute expiry waits with a test-only time mechanism that advances both the supervisor and its CLI subprocesses consistently. Preserve lease generation, renewal-window, expiry, late-result, and recovery assertions. If consistent time cannot be established, isolate a bounded real-clock integration case rather than weakening authority checks or extending timeouts.

Use recorded per-file durations to rebalance the four shards after the wait removal. Keep two workers per standard Linux runner initially. Increasing worker count, disabling isolation, or changing pools requires paired measurements and independent compatibility proof.

### Shard rebalance and build start (2026-11-14)

[Run 43579262574](https://github.com/kimjh96/lervo/actions/runs/43579262574), the dispatched verification of prepared pull request #227, took about 23 minutes. Lint took 2.5 minutes, native artifacts 0.3, the build 4.9, the four test shards 6.7, 9.6, 12.6 and 14.8, and the aggregate 0.3. Two causes made it slow:

- The duration profile still held run 37706186392's October weights. Repository-knowledge runtime tests have grown since then, so shard test time ranged from 276 to 984 seconds.
- The build waited for lint, although it uses nothing lint produces.

The changes:

- `scripts/quality/refresh-test-durations.mjs` rewrites the profile from a full run's `gh run view --log` output. It keeps the 128 slowest files. Every other file, including a new one, takes the planner's 1.5-second default weight. The profile from run 43579262574 keeps files of 2.4 seconds and longer.
- The CI sequencer also starts each shard's slowest known files first, so both workers finish close together.
- A `Plan verification` job resolves revision, scope, distribution and reuse without installing dependencies. Lint and the native artifact job both start from it. Test shards and distribution checks still wait for lint, which finishes before the build, so a lint failure spends no shard time. The aggregate requires the plan and lint.

Applied to that run's own per-file times, the new placement gives each shard 640 to 659 seconds of test time. This is a placement estimate, not a measurement. Adding the run's average collection time, each shard job should take about 10 to 11.5 minutes instead of up to 14.8. The critical path becomes plan, native artifacts, build, slowest shard and aggregate: about 16.5 minutes instead of 23. The extra job costs about one billed runner-minute per run.

The profile stays in the test digest. A refresh therefore changes the digest once, so the refreshing run executes every shard with the new placement and verifies the refresh itself. Release preparation never touches the profile, so prepared pull requests and merged main still reuse tests. Refresh the profile in its own change when shard times drift apart. The next full hosted run's shard times remain to be observed.

### Per-file test input ledgers (2026-11-14)

Shard balance from one run's test time alone does not hold: each shard also spends 390 to 606 seconds collecting files, and per-file test time varies between runs. In the latest run, shards took 7.9 to 14.4 minutes. [ADR-0565](../../decisions/operations/services/0565-record-what-each-ci-test-file-reads-before-reusing-its-result.md) proposes per-file result reuse keyed by what each file was observed to read, plus a toolchain digest. It is delivered in stages:

1. Stage 1, delivered: a preloaded recorder and one ledger per shard. Each ledger lists every file's result, test and collection time, recorded inputs and closed uncacheable reasons. Ledgers upload with `if: always()` for seven days. The `LERVO_CI_TEST_LEDGER` repository variable set to `off` disables recording without a commit. The refresh script can build the timing profile from the median test plus collection time over recent ledgers. Nothing reads the ledgers to select, skip or judge tests.
2. Stage 2, delivered locally: the `Test reuse shadow` job runs after the shards and never fails the run. It reconstructs the shards' tree, publishes the run's input index for seven days, and predicts reuse from trusted runs of the last 24 hours. Trusted runs are pushes and daily audits of `main`, and pull requests whose four shards passed. A result is reusable only under the same G, with a passed result, a complete closure, equal digests for every recorded input and copied tree, equal listings, still-absent probes, and no failure of the file under that G within 24 hours. The job compares every prediction with this run's results and publishes a ranked report for 30 days; a false reuse is listed first and annotated. It must record zero false reuses for at least 14 days.
3. Stage 3: per-file reuse, only through a separate decision after Stage 2.

Test isolation now also sets `LERVO_USER_CAPABILITY_ROOT`. In the first hosted ledgers, 77 of 1,267 files had `host_state` only from probing `~/.lervo/capabilities/packages`. With the fix, complete closures rise from 1,021 to an expected 1,098.

A dry run against hosted ledgers predicted 80.6% reuse for an unchanged rerun and 80.3% for the next real push, with no false reuse. One edit in a leaf package, a CLI command or `packages/core` left 80.4%, 77.4% and 52.0%. Two findings limit the effect:

- Shards of one run landed on two runner image builds of the same release, so a strict G cut the next-push rate to 40.0%.
- The rerun files hold most of the time. In the unchanged rerun, the estimated shard jobs only drop from 477–734 seconds to 312–523 seconds, because unobserved children alone hold 1,820 of the remaining 2,620 seconds of file time.

An adversarial review then demonstrated nine false reuses. The shadow now fails closed on each: typed digests with metadata, both views of copied trees, typed listings, recorded writes and unreadable paths, an incomplete history, and the environment in G. On the same hosted ledgers, an unchanged rerun fell to 77.6% and the next push to 77.3%, with no false reuse. With writes recorded, two branch shards on WSL predicted about 30%: three test files start unrecorded children inside the repository, and every file finishing after them reruns.

The ADR records the rules, the [shadow contract](../../foundation/ci-test-reuse-shadow.md) the job, digests, reasons and report, and the [shadow evidence](../../evidence/quality/ci-test-reuse-shadow.md) the dry run.

- [x] Stage 1 recorder, ledgers, toolchain digest and ledger-based weights pass local tests.
- [ ] Hosted ledgers observed for every shard, and the profile refreshed from at least three runs.
- [x] Stage 2 shadow job, input index, predictor and report pass local tests and a dry run against hosted ledgers.
- [ ] Hosted shadow reports observed, including the reuse rate after the capability-root fix.
- [ ] Stage 2 shadow comparison: at least 14 days without a false reuse.
- [ ] Decide whether G may ignore the runner image build number, from evidence that both builds install the same tools.
- [ ] Observe the children that drop `NODE_OPTIONS`, the dominant remaining rerun time.
- [x] Make the unrecorded children of the reporter and runtime-inspection tests start outside the repository. A corrected WSL run showed 15 to 18 more such files per shard, so shard reuse stays at 0%.
- [ ] Remove the unseen writers listed in the [shadow gaps](../../foundation/ci-test-reuse-shadow-gaps.md), starting with the supervision provider fixtures, and confirm the drop in `shard_written_input` with a shard ledger.
- [ ] Compare the environment value digests and kernel releases of hosted shards, then decide which differences may leave G.

### Test module loading (2026-11-15)

In [run 43652187030](https://github.com/kimjh96/lervo/actions/runs/43652187030), collection took 455 to 613 seconds per shard: 2,037 of 5,158 seconds of worker time. Every one of the 1,271 test files loads its module graph again in its own process. A WSL run of shard 1 with per-module execution timing found three causes:

| Cause                                               | Evidence on shard 1 (312 of 318 files measured)                                                                                                                                                                                                                   |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The 6 MB generated validators, inlined by vite-node | Loaded by 227 files. Their own execution took 171 of 381 seconds of collection, about 750 ms per file. The importing `validate.ts` added 20 seconds, mostly fetching it. Node loads the same file in about 200 ms.                                                |
| Cross-package barrels                               | Static graphs load 741,924 modules across all files. Importing each name from its declaring module cuts that by 44%. Barrels that tests mock or use as module objects must stay, which limits the cut to 36%. The rest of collection costs about 1 ms per module. |
| Repeated native compilation                         | Parser dependencies and the validators compile again in every process.                                                                                                                                                                                            |

The [CI reference](../../foundation/code-quality-and-commit-ci.md#source-test-module-loading) describes the two fixes that ship and why each preserves behavior: native loading of the generated validators and one Node compile cache per run. A third fix, a Vitest plugin that imports barrel names from their declaring modules, was held back: an independent review found that its rewrites hid barrel files from the ADR-0565 ledger closure, that `import d, * as ns`, assigned dynamic imports, and mocks in setup files bypassed its pins, and that evaluation order changes had no guard. The reference now describes how each is closed.

Each shard below ran on WSL with two workers and the CI timeout, first under the original `vitest.config.ts` and then under the configuration with all three fixes, back to back on the same files. Times are Vitest's Duration and collect totals, in seconds:

| Shard | Duration before | Duration after | Collect before | Collect after |
| ----- | --------------- | -------------- | -------------- | ------------- |
| 1     | 523.5           | 465.8          | 323.5          | 194.6         |
| 2     | 497.3           | 372.4          | 364.8          | 174.6         |
| 3     | 454.7           | 354.8          | 359.9          | 174.7         |
| 4     | 561.0           | 461.1          | 354.8          | 179.6         |
| Total | 2,036.5         | 1,654.1        | 1,402.9        | 723.4         |

With all three fixes, collection fell by 48% and shard duration by 19%. Both configurations ran the same 1,272 files and 7,163 tests: the 1,271 earlier files plus the plugin's unit tests. The release tests that fail on this WSL host failed under both. Four `apps/cli/test/upgrade-*` tests failed only in the new configuration's shard runs, and other upgrade tests failed only in original-configuration runs. Their upgrade plans observe host runtime directories and processes, so a file running at the same time can change the plan between two calls. Run alone, alternating configurations, the failed upgrade files passed under the new configuration every time; the original configuration failed once.

In a separate back-to-back pair on shard 1, the plugin alone cut module executions from 194,352 to 136,545 and collection from 221 to 184 seconds. Without it, the two shipped fixes account for the rest: native loading removed about 191 of 381 seconds of shard-1 collection, and the compile cache cut collection on 297 shared files from 251 to 226-229 seconds on top of native loading. The next hosted run measures the shipped pair.

After those fixes, the plugin ran on WSL shard 1 against the configuration of current main, in two back-to-back pairs in opposite orders. Both configurations ran the same 321 files and 1,717 tests. Times are Vitest's Duration and phase totals, in seconds:

| Pair and order | Configuration | Duration | Collect | Transform | Tests |
| -------------- | ------------- | -------- | ------- | --------- | ----- |
| 1, off first   | main          | 502.9    | 183.9   | 11.7      | 766.7 |
| 1, off first   | plugin        | 475.1    | 146.5   | 15.1      | 752.9 |
| 2, on first    | plugin        | 570.9    | 185.1   | 20.9      | 892.5 |
| 2, on first    | main          | 638.2    | 227.2   | 22.6      | 983.9 |

The plugin cut collection by 20% and 19% and shard duration by 6% and 11%. The owner's jobs share this host, so the two pairs differ by about 25% in absolute time. On a 60-file slice of the same shard, the workers loaded 43,056 modules instead of 59,913. The plugin adds 3 to 5 seconds of transform time to parse the barrels and scan the tests. A single file therefore ran slower with it, 1.9 to 2.9 seconds instead of 1.2 for `provider-cli-events.test.ts`, so only the CI shard configuration loads it. An earlier version that also registered each consulted barrel as a Vite watch file made both pairs slower, with Duration 586.6 against 537.8 and 584.8 against 514.5: Vite resolves every watch file into its module graph on each transform. In every run, the only failures were `scripts/release/test/release-publication-authorization.test.mjs`, which fails on this host under both configurations, and tests in `apps/cli/test/upgrade-command.test.ts`, `upgrade-knowledge-materialization-wait.test.ts`, `upgrade-resident-exclusion.test.ts`, and `knowledge-host-residents.test.ts`. Run alone in four alternating runs, those four files failed two, one, two, and two tests, a different set each time under either configuration. They observe host runtime directories and processes.

- [x] Measure collection by module and fix its two largest causes without changing test selection, assertions, pool, or isolation.
- [x] Ship the direct barrel import plugin only after its rewrites record the barrels they read in the ledger closure and its pins cover `import d, * as ns`, assigned dynamic imports, and mocks in setup files.
- [ ] Observe collection time in the next hosted run and refresh the duration profile.
- [ ] Decide whether the generated validators should build each schema's validator lazily. Evaluating all 219 still takes about 135 ms of the remaining 200 ms per file. The CLI pays the same cost on each start that validates.

## Responsibility and evidence contracts

| Owner              | Responsibility                                                                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/quality`  | Pure scope classification, exact build transfer validation, aggregate CI verification, bounded timing summaries, test input ledgers and the reuse shadow. |
| `scripts/release`  | Release eligibility, generation, candidate verification handoff, Git effect admission, and PR evidence.                                                   |
| Node-runtime tests | Test-only clock and native-completion assertions; no production lease-policy change.                                                                      |
| GitHub workflows   | Event translation, job dependencies, pinned actions, least permissions, concurrency, and short owner-command entrypoints.                                 |

The implementation defines versioned build-transfer and verification receipts. Required fields include schema version, verification contract version, source SHA, workflow/run identity, platform, Node version, build digest, required job dispositions, and coverage mode. Expose only identifiers, digests, counts, durations, and closed failure codes. Exclude credentials, user payload, and local host paths. Store bounded current artifacts in GitHub; do not add a tracked file per CI run or a Lervo runtime event.

For verification, `passed` means all required jobs succeeded; `failed` blocks release effects; `cancelled` and `unknown` grant no effect authority. `documentation_only` explicitly means the full suite was not executed. Failure and scope labels must remain distinct in the aggregate result and PR text.

## Expected effect and limits

| Change                                           | Expected effect from the baseline                                                                                                                                   |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Five builds reduced to one                       | Avoid 16.0–19.8 runner-minutes per full CI before artifact-transfer overhead, approximately 23–24% of sampled CI use.                                               |
| Documentation-only light path                    | Target 2–4 minutes wall time and avoid most of the 81.4-runner-minute full path on qualifying changes. Classification correctness remains an acceptance gate.       |
| Release generation without duplicate full checks | Target 5–15 minutes for generation and handoff, compared with the observed 84.08-minute preparation median. Candidate verification still consumes runner time.      |
| Short expiry tests and balanced shards           | Remove roughly six minutes of intentional wait from the full test workload; measure the resulting critical path rather than promising an equal wall-time reduction. |

These are targets and gross opportunities, not measured savings. Removing tests from preparation may move them into candidate CI rather than eliminate their cost. Savings must include candidate verification, main verification, daily audits, cancelled work, artifact transfer, and storage. Do not add the percentages or claim a repository-wide reduction before measuring the complete lifecycle.

## Delivery and acceptance

Local implementation is verified: all four minimum-Node shards passed 5,145 tests across 1,041 files, with eight existing skips and exact discovered-file coverage. Quality, type, artifact, distribution, documentation, and task-base release checks passed. [Implementation evidence](../../evidence/quality/ci-cost-and-duration-implementation.md) preserves intermediate failure investigation and final results. Hosted rollout and lifecycle-cost acceptance remain open.

Owner confirmation was received before implementation. Deliver in this order:

1. Amend CI/release contracts and add tests for scope selection, failed admission, stale revisions, duplicate candidate routes, and aggregate failure propagation.
2. Implement shared build transfer with real create/restore, executable-mode, corruption, and wrong-revision tests. Retain full source-change coverage.
3. Implement conservative light-path admission and the full manual/daily fallback.
4. Separate release generation from candidate verification; gate every Git effect on its exact evidence and keep npm publication authority separate.
5. Remove expiry waits with cross-process assertions, then rebalance shards using new timing evidence.
6. Run focused suites, provider-neutral contracts if touched, full verification, `pnpm quality:check`, typecheck, architecture, documentation lifecycle, and `pnpm release:completion:check --base 7a5cce30966063861b2927be85d20be31f7e4627`.
7. With separately authorized remote rollout, observe ordinary code, documentation-only, generated-candidate, merged-release, stale/cancelled, and three-platform cases. Record at least five comparable successful full CI runs and seven days of complete lifecycle usage before claiming cost acceptance.

- [x] Owner confirmed the design and implementation scope.
- [x] Exact-revision transfer and failure contracts pass locally.
- [x] Full test and artifact coverage survives the new job graph.
- [x] Light-path exclusions and full fallbacks pass adversarial fixtures.
- [x] Candidate PR evidence and tag gates reject unverified or stale revisions.
- [x] Native-completion timing improvements preserve the expiry/recovery cases.
- [x] Required local checks and base-bound release inspection pass.
- [ ] Hosted workflow acceptance and measured lifecycle savings are observed.

Rollback the workflow graph to the prior full verification configuration if admission or transfer cannot be trusted. Rollback never moves a release tag, publishes npm, or replays an uncertain Git effect automatically.

## Related contracts

- [Code convention](../../foundation/code-convention.md) and [repository script architecture](../../architecture/repository-scripts.md).
- [CI reference](../../foundation/code-quality-and-commit-ci.md) and [ADR-0470 CI requirements](../../decisions/operations/services/0470-admit-every-knowledge-resident-and-run-one-host-resident-service.md).
- [ADR-0221 release preparation](../../decisions/release/packaging/0221-reviewed-cli-release-preparation.md), [base-bound release completion](../../decisions/release/packaging/0223-base-bound-cli-release-completion.md), and [release workflow evidence](../../distribution/release-preparation-workflow-evidence.md).
- [Multi-platform release matrix](../../decisions/release/packaging/0089-cli-multi-platform-release-matrix.md) and [release automation roadmap](../release/version-management-automation.md).
