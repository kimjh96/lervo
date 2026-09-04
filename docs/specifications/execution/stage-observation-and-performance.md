# Execution stage observation and performance

Status: `active`

As of: 2026-09-04

This document defines Lervo-owned stage timing and the reproducible performance gate
linked from the [execution specification](../execution.md). It does not extend execution
authority or claim provider, model, network, Hub, billing, or whole-task observation.

## Responsibility boundaries

- `@lervo/execution-contract` owns the clock-independent stage recorder, catalogued
  parent relationships, and canonical environment-profile bytes and hashes.
- Managed and terminal adapters own clock injection, runtime-profile construction, and
  event composition. Core execution does not depend on a provider-specific timer or
  telemetry backend.
- `@lervo/execution-observability` and `@lervo/diagnostics` own pure projections. CLI
  formatters render those projections and do not recalculate durations.
- `@lervo/execution-performance` owns paired statistics, budgets, and report
  verification. Fixture preparation and cleanup remain replaceable harness ports.

New clocks, persistence backends, exporters, providers, fixtures, or presentation
surfaces must implement these boundaries rather than adding policy to the managed-run
or terminal entrypoint. A new stage or changed parent relationship requires a new
catalog version.

## Observation contract

One observation uses an injected monotonic nanosecond clock and contains at most 32
catalogued stages. A stage has a stable ID, optional parent, outcome, elapsed duration,
and bounded occurrence count. Sequential repetitions aggregate under one ID.
Simultaneous duplicates, clock regression, missing or inconsistent parents, and
finalization with active stages are invalid.

The `execution.stages.observed` event binds one managed work or direct-terminal
coordinate, observation-set digest, environment-profile digest, repository profile,
and results. Current managed producers write a null terminal hook. Current direct
producers write `UserPromptSubmit` or `Stop`. Historical valid events without the
additive hook field remain readable, but their direct hook coordinate is unavailable.
The [events and privacy specification](events-and-privacy.md) owns the exact event
allowlist and failure meaning.

One canonical `ExecutionEnvironmentProfileV1` CAS artifact records build, nullable
adapter and provider, OS, architecture, Node version, observed corpus counts, declared
cache state, and concurrency. It excludes paths, prompts, queries, outputs,
credentials, and vendor span names. Managed execution persists and reads it back before
provider startup. Profile failure blocks managed provider startup and creates no
dangling stage success.

## Managed stages

Managed execution measures repository snapshot, provider start, corpus preparation,
context injection, provider turn, provider stop, verification, and total. The final
stage event precedes `run.completed` or `run.failed`. A completed current run without
its required set is invalid telemetry; consumers do not invent durations.

At most one unique set may describe a managed run. Projections reject contradictory
set IDs, invalid trees, cross-run joins, and duration aggregation across different
environment profiles.

## Direct-terminal stages

Direct hooks measure only Lervo-owned ingress, repository discovery, lifecycle
inspection, corpus preparation, query projection, repository snapshot, search, exact
loading, context assembly, event commit, and total. Catalog version 2 names the current
provider projection stage `query_projection`; it retains `projection_admission` only so
catalog version 1 evidence remains readable. A current direct projection includes
capability-free runner startup and one query-producing provider turn, not a separate
synthetic readiness turn. Direct hooks do not observe the provider turn outside the
hook.

Terminal lifecycle inspection may reuse one exact prepared repository-knowledge scan across its
read-only compiler checks. Its knowledge-only result may be retained as a rebuildable local cache
bound to the CLI version, repository snapshot revision, and supplemental-source digest. An active
materialization transaction, any coordinate mismatch, invalid state, or a technical inspection
failure prevents reuse. Cache reuse changes neither lifecycle findings nor evidence meaning. The
current direct-terminal environment profile leaves cache state `unknown`; timing reports therefore
do not infer a warm or cold cohort from cache behavior.

A version 1 writer skips version 2 stage evidence and preserves the documented
availability-safe hook result. A version 2 writer stores the profile in local CAS and
appends a system-authored event. Measurement or persistence failure records no false
success and leaves coverage partial or unavailable; it does not erase or reinterpret a
valid context or turn event. Projections reject duplicate hook sets and cross-session
joins and never add durations across environment profiles.

## Paired performance gate

The provider-free version 1 protocol runs 100 alternating baseline/candidate pairs for
each declared profile: small cold prompt, small warm prompt, medium warm prompt, large
warm prompt, small warm Stop, and four concurrent medium warm prompts. Baseline disables
only stage recording. Both arms start each pair from the same repository snapshot.
Warm templates receive one successful unmeasured prompt before cloning. Stop preparation
occurs outside the measured interval with recording disabled for both arms. Concurrent
hooks use independent repositories.

Every report binds the exact source-byte digest, protocol digest, privacy-safe
environment profiles and hashes, population, nearest-rank p50 and p95, eligible p99,
maximum, process CPU, process peak RSS, failure and timeout rates, stage distributions,
signed paired overhead, and retrieval, lifecycle, and privacy correctness. The source
digest excludes only the generated report and rebuildable `docs/knowledge/`
projections. Any other source change makes the report stale.

Each profile also binds one measurement-environment assessment derived only from the baseline
duration distribution. `measurementEnvironment.status` is `unstable` when baseline p95 exceeds two
times baseline p50, or when a positive baseline p95 has a zero p50. The report retains the nullable
p95-to-p50 ratio, the fixed 20,000 basis-point boundary, and the exact
`baseline_p95_tail_inflation_exceeded` reason. These aggregate fields have the same privacy boundary
as the duration distribution and add no host-process details.

Version 1 has no exception path. `budgetStatus` retains the existing numerical and correctness
decision. `acceptanceStatus` additionally requires a stable measurement environment, and
`allProfilesPassed` requires every acceptance status to pass. Every profile must satisfy all of
these gates:

- every sample is below 30 seconds;
- prompt p95 is at most 15 seconds;
- prompt p99, when the population supports it, is at most 24 seconds;
- Stop p95 is at most 5 seconds;
- candidate p95 exceeds baseline p95 by no more than the greater of 10 percent or 25
  milliseconds; and
- neither arm has an execution, timeout, retrieval, lifecycle, or privacy failure.

An unstable environment adds `measurement_environment_unstable` without deleting a simultaneous
`p95_regression_exceeded` or any other failure. The runner performs one complete observation and no
automatic retry, filtering, or result selection. An unstable report exits unsuccessfully and cannot
enter foundation readiness.

The generated JSON is canonical aggregate evidence. Its Markdown companion interprets
the bound observation without duplicating mutable measurements. Stage evidence proves
elapsed Lervo work only; it does not prove provider acceptance, model attention,
learning, semantic use, or task correctness.

## Verification

```bash
pnpm foundation:performance:run
pnpm foundation:performance:check
```

The run command rebuilds the harness and replaces the generated report. The check
validates structure, populations, statistics, decisions, correctness, privacy, report
identity, protocol digest, current source digest, and the absence of exceptions.

## References

- [Execution events and privacy](events-and-privacy.md)
- [Stage evidence ADR](../../decisions/operations/trace/0335-record-and-verify-bounded-execution-stage-evidence.md)
- [Short-profile measurement floor ADR](../../decisions/operations/trace/0339-calibrate-short-profile-performance-measurement-floor.md)
- [Measurement environment ADR](../../decisions/operations/trace/0357-fail-closed-on-unstable-performance-measurement-environments.md)
- [Foundation execution performance evidence](../../evidence/foundation/execution-performance-v1.md)
- [Direct terminal projection operational evidence](../../evidence/foundation/terminal-direct-query-projection-operational-v1.md)
