# Foundation execution performance evidence

Status: `accepted`

As of: 2026-09-04

This evidence covers provider-free FH3 terminal-hook profiles. The [generated JSON report](execution-performance-v1.json) is the bounded aggregate source. It binds the benchmark build, exact source-byte revision, complete environment profiles and digests, population, statistics, correctness, and report identity. It excludes prompts, outputs, repository paths, and credentials.

## Protocol

Each profile contains 200 paired baseline and candidate observations. Odd repetitions run baseline first; even repetitions run candidate first. Baseline disables only stage recording. Both arms otherwise use the same activated version 2 behavior and start from the same fixture snapshot.

Each observation runs once without automatic retry. A profile is accepted only if baseline tail latency is stable: baseline p95 must not exceed twice baseline p50, and a positive p95 with a zero p50 is unstable. Because this control uses the arm without stage recording, candidate instrumentation cannot determine environment acceptance.

Small, medium, and large fixtures contain 10, 66, and 258 source documents. A cold snapshot has no prior hook. A warm snapshot has one successful, unmeasured, stage-enabled prompt before cloning, including its reusable environment profile. Its existing stage event is shared fixture state; only a newly appended event counts as candidate telemetry.

Stop preparation occurs outside the measured Stop interval and disables recording for both arms. A concurrent observation is one batch of four independent medium-repository hooks. Preparation and cleanup are outside the measured interval, and sample repositories are removed afterward.

The recorded environment was macOS arm64 with Node v26.5.1. OS cache state, power mode, and competing workloads were not independently controlled. Therefore, `cold` and `warm` describe declared Lervo fixture state, not hardware-cache state.

## Accepted observation

The generated report retains the exact profile table instead of duplicating mutable measurements here. Every baseline and candidate observation completed. Retrieval, lifecycle, declared cold-state, and stage-privacy correctness passed for every observation. Failure and timeout rates are zero. All prompt p95 and eligible p99 values are well below 15 and 24 seconds, Stop p95 is below 5 seconds, and no sample reaches 30 seconds.

The regression gate is 10 percent. Profiles shorter than the 25-millisecond absolute measurement floor use that floor because durable observation transactions and filesystem-tail variation make ratio-only decisions unstable. The report records the actual ratio, absolute difference, and applicable allowance; no unrecorded exception applies.

The report separately records `budgetStatus`, `measurementEnvironment`, and `acceptanceStatus`. Every accepted profile has a stable measurement environment and passing budget status. An unstable baseline adds `baseline_p95_tail_inflation_exceeded` and `measurement_environment_unstable`, remains ineligible even if numerical budgets pass, and does not suppress simultaneous regression or correctness failures.

## Stage diagnosis and optimization

Prompt latency scales mainly with corpus preparation, search, and repository snapshots. Large-corpus search dominates the prompt stage; lifecycle inspection dominates Stop. Investigate these phases first if representative repositories approach external budgets. Exact loading is comparatively small for this corpus.

An initial diagnostic run reopened project storage solely to persist the stage event. This repeated event-chain verification and added avoidable fixed overhead. The final implementation reuses the open hook observation storage boundary and its verified writer version. It reuses an already verified content-addressed environment profile; otherwise, it accepts the CAS `put` hash and byte-count receipt instead of immediately rereading that profile. CAS owns read and write integrity, retained by focused CAS and project-storage tests. Timing, profile persistence, projection, budget policy, and rendering remain separate.

A second preliminary run used different growing warm repositories for the arms. Candidate accumulated stage events while baseline did not, causing later candidate reads to verify longer histories. The result was rejected as incomparable. For every pair, the accepted harness clones both arms from the same cold or pre-warmed snapshot. This fixture correction—not an exception or timeout increase—removed the apparent Stop and concurrency regression.

## Limits

The report measures Lervo-owned, provider-free hook work in synthetic local repositories. It does not measure live-provider latency, provider startup, model inference, network, Hub, billing, or whole-task execution. The concurrent profile uses independent repositories and does not cover shared-writer contention. Process peak RSS is process-wide and may include earlier profiles; it is a conservative run peak, not per-sample isolated allocation. New source bytes or environment changes make the checked report stale and require regeneration.

## Verification

```bash
pnpm foundation:performance:check
```

The check rebuilds the verifier; validates report structure, protocol digest, statistics, budget decisions, measurement-environment and acceptance decisions, correctness, privacy declarations, and report identity; recomputes the current source-byte revision while excluding generated JSON and rebuildable `docs/knowledge/` projections; and requires every profile to pass.
