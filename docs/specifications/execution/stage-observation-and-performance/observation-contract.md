# Stage observation contract and managed stages

## Responsibility boundaries

- `@lervo/execution-contract` owns the clock-independent stage recorder, catalogued parent relationships, and canonical environment-profile bytes and hashes.
- Managed and terminal adapters own clock injection, runtime-profile construction, and event composition. Core execution does not depend on a provider-specific timer or telemetry backend.
- `@lervo/execution-observability` and `@lervo/diagnostics` own pure projections. CLI formatters render them without recalculating durations.
- `@lervo/execution-performance` owns paired statistics, budgets, and report verification. Fixture preparation and cleanup remain replaceable harness ports.

New clocks, persistence backends, exporters, providers, fixtures, or presentation surfaces must implement these boundaries rather than add policy to the managed-run or terminal entrypoint. New stages or changed parent relationships require a new catalog version.

## Observation contract

An observation uses an injected monotonic nanosecond clock and contains at most 32 catalogued stages. Each stage has a stable ID, optional parent, outcome, elapsed duration, and bounded occurrence count. Sequential repetitions aggregate under one ID. Simultaneous duplicates, clock regression, missing or inconsistent parents, and finalization with active stages are invalid.

`execution.stages.observed` binds one managed work or direct-terminal coordinate, observation-set digest, environment-profile digest, repository profile, and results. Current managed producers write a null terminal hook; current direct producers write `UserPromptSubmit` or `Stop`. Historical valid events without the additive hook field remain readable, but their direct hook coordinate is unavailable. The [events and privacy specification](../events-and-privacy.md) owns the exact event allowlist and failure meaning.

One canonical `ExecutionEnvironmentProfileV1` CAS artifact records build, nullable adapter and provider, OS, architecture, Node version, observed corpus counts, declared cache state, and concurrency. It excludes paths, prompts, queries, outputs, credentials, and vendor span names. Managed execution persists and reads it back before provider startup. Profile failure blocks managed provider startup and creates no dangling stage success.

## Managed stages

Managed execution measures repository snapshot, provider start, corpus preparation, context injection, provider turn, provider stop, verification, and total. The final stage event precedes `run.completed` or `run.failed`. A completed current run without its required set is invalid telemetry; consumers must not invent durations.

At most one unique set may describe a managed run. Projections reject contradictory set IDs, invalid trees, cross-run joins, and duration aggregation across different environment profiles.

Governed duration policy groups exact managed observations by provider, causal resource scope, and stage ID. Its value is the maximum per-run duration, not the sum of sequential or concurrent elapsed time. Missing sets or required stages make the policy population unobservable. An inclusive reached threshold blocks the next attempt and prevents an otherwise successful governed assignment from finalizing as passed. It does not replace adapter deadlines or prove provider termination.
