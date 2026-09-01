# Foundation execution performance evidence

Status: `accepted`

As of: 2026-09-01

This evidence records the provider-free FH3 terminal-hook profiles. The
[generated JSON report](execution-performance-v1.json) is the bounded aggregate source
and binds its benchmark build, exact source-byte revision, full environment profiles and
digests, population, statistics, correctness, and report identity. The checked report
excludes prompts, outputs, repository paths, and credentials.

## Protocol

Each profile has 200 paired baseline and candidate observations. Odd repetitions run
baseline first and even repetitions run candidate first. Baseline disables only stage
recording. Both arms otherwise use the same activated version 2 behavior and start from
the same fixture snapshot.

Small, medium, and large fixtures contain 10, 66, and 258 source documents. A cold
snapshot has no prior hook; a warm snapshot has one successful unmeasured stage-enabled
prompt before cloning, including its reusable environment profile. Its existing stage
event is common fixture state and only a newly appended event counts as candidate
telemetry. Stop preparation is outside the measured Stop interval and disables recording
for both arms. The concurrent observation unit is one batch of four independent medium
repository hooks. Preparation and cleanup are outside the measured interval, and sample
repositories are removed after use.

The environment recorded in the report was macOS arm64, Node v26.5.1. OS cache state,
power mode, and competing workloads are not independently controlled, so `cold` and
`warm` describe the declared Lervo fixture state rather than a hardware-cache claim.

## Accepted observation

The generated report retains the exact profile table rather than duplicating mutable
measurements in this interpretation. Every baseline and candidate observation completed.
Retrieval, lifecycle, declared cold-state, and stage privacy correctness passed for every
observation. Failure and timeout rates are zero. All prompt p95 and eligible p99 values
remain far below 15 and 24 seconds, Stop p95 remains below 5 seconds, and no sample
reaches 30 seconds. The regression gate remains 10 percent, with a 10-millisecond
absolute measurement floor for shorter profiles where a durable observation transaction
and filesystem tail variation make a ratio-only decision unstable. The report retains
the actual ratio, absolute difference, and applicable allowance; no unrecorded exception
is applied.

## Stage diagnosis and optimization

Prompt latency scales mainly in corpus preparation, search, and repository snapshot.
Large-corpus search is the dominant prompt stage, while Stop is dominated by lifecycle
inspection. These are the first phases to investigate if representative repositories
approach the external budgets; exact loading remains comparatively small in this corpus.

An initial diagnostic run opened project storage again only to persist the stage event.
That repeated event-chain verification and produced avoidable fixed overhead. The final
implementation reuses the open hook observation storage boundary and its verified writer
version. It reuses an already verified content-addressed environment profile and otherwise
accepts the CAS `put` hash and byte-count receipt instead of immediately rereading the same
profile. CAS owns read and write integrity; focused CAS and project-storage tests retain
that proof. Timing, profile persistence, projection, budget policy, and rendering remain
separate.

A second preliminary run reused different growing warm repositories for the two arms.
The candidate accumulated stage events while baseline did not, so later candidate reads
verified longer histories. That result was rejected as incomparable. The accepted
harness clones both arms from the same cold or pre-warmed snapshot for every pair. This
fixture correction, not an exception or timeout increase, removed the apparent Stop and
concurrency regression.

## Limits

The report measures Lervo-owned provider-free hook work in synthetic local repositories.
It is not a live-provider latency, provider startup, model inference, network, Hub,
billing, or whole-task observation. The concurrent profile uses independent repositories
and does not claim shared-writer contention coverage. Process peak RSS is process-wide
and may include earlier profiles; it is a conservative run peak, not per-sample isolated
allocation. New source bytes or environment changes make the checked report stale and
require regeneration.

## Verification

```bash
pnpm foundation:performance:check
```

The check rebuilds the verifier, validates report structure, protocol digest, statistics,
budget decisions, correctness, privacy declarations and report identity, recomputes the
current source-byte revision excluding the generated JSON and rebuildable
`docs/knowledge/` projections, and requires all profiles to pass.
