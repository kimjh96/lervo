# GitHub Actions cost and duration redesign

Status: `active`
As of: 2026-10-08
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
  -> resolve exact revision and comparison base
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

## Responsibility and evidence contracts

| Owner              | Responsibility                                                                                                            |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `scripts/quality`  | Pure scope classification, exact build transfer validation, aggregate CI verification, bounded timing summaries.          |
| `scripts/release`  | Release eligibility, generation, candidate verification handoff, Git effect admission, and PR evidence.                   |
| Node-runtime tests | Test-only clock and native-completion assertions; no production lease-policy change.                                      |
| GitHub workflows   | Event translation, job dependencies, pinned actions, least permissions, concurrency, and short owner-command entrypoints. |

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
