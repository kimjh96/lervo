# ADR-0335: Record and verify bounded execution stage evidence

- Status: `accepted`
- Decision date: 2026-09-01

## Context

FH2 can project causal work and provider-reported resources, but a total hook duration
cannot identify whether repository discovery, knowledge preparation, search, lifecycle
inspection, or persistence is slow. Direct terminal work is unmanaged, so Lervo must
measure only its own hook boundary and must not imply whole-provider observability.

Timing code placed directly in the managed-run or terminal command would couple clock,
environment, persistence, aggregation, budget policy, and presentation. A benchmark
that compares continually diverging event histories would also attribute fixture drift
to instrumentation.

## Decision

Implement stage evidence as five separate responsibilities:

- `@lervo/execution-contract` owns monotonic recording, bounded parent consistency, and
  canonical environment-profile bytes and hashes;
- managed and terminal observation adapters own clocks, runtime profile construction,
  and event composition;
- `@lervo/execution-observability` and diagnostics own pure managed and terminal
  projections;
- `@lervo/execution-performance` owns paired statistics, budgets, and report
  verification; and
- CLI formatters render the shared projections without recalculating them.

`execution.stages.observed` adds the optional, history-compatible `terminalHook` field.
Current managed producers always write null; current unmanaged producers always write
`UserPromptSubmit` or `Stop`. An older valid set without the field remains readable but
cannot be assigned to one direct hook, so terminal coverage reports its hook coordinate
as unavailable. One observation set has at most 32 catalogued stages. Repeated
sequential stages aggregate under one stable stage ID; simultaneous duplicate stages,
clock regression, inconsistent parents, an absent parent, and finalization with active
stages are invalid.

Managed runs persist and read back one canonical `ExecutionEnvironmentProfileV1` CAS
artifact before provider startup. They measure repository snapshot, provider start,
corpus preparation, context injection, provider turn, provider stop, verification, and
total. The final stage event precedes `run.completed` or `run.failed`. A profile-storage
failure blocks provider startup; a missing final set makes completed-run telemetry
invalid rather than inventing durations.

Direct terminal hooks measure only Lervo-owned ingress, repository discovery, lifecycle
inspection, corpus preparation, query projection, repository snapshot, search, exact
loading, context assembly, event commit, and total. A version 1 writer skips the version
2 stage event and retains the availability-safe hook result. A version 2 writer stores
the profile in local CAS and appends a system-authored stage event. Stage persistence is
not execution authority and does not rewrite or invalidate an already valid terminal
context or turn event. If measurement or persistence fails, the hook returns its
documented availability-safe result, records no false stage success, and terminal
coverage reports the stage set as partial or unavailable. This supersedes the stronger
atomicity wording in ADR-0331.

The managed work report and terminal coverage reject contradictory observation-set IDs,
invalid trees, duplicate terminal-hook sets, cross-run or cross-session joins, and more
than one unique managed set per run. They never add durations across different
environment profiles.

## Performance protocol

The provider-free FH3 harness uses 100 alternating baseline/candidate pairs for each of
six declared profiles: small cold prompt, small warm prompt, medium warm prompt, large
warm prompt, small warm Stop, and a concurrent batch of four medium warm prompts.
Baseline disables only stage recording; all other version 2 behavior remains identical.

Every pair starts from the same fixture snapshot. Warm snapshots contain one successful
unmeasured prompt before cloning; cold snapshots do not. Stop preparation occurs outside
the measured Stop interval with recording disabled for both arms. Concurrent batches use
four independent repositories, so they measure runtime contention without fabricating
shared-writer conflicts. Fixture preparation and cleanup are explicit ports and every
sample repository is removed after observation.

The report binds the exact source-byte digest, benchmark protocol digest, full
privacy-safe environment profile and digest, population, nearest-rank p50/p95 and
eligible p99, maximum, process CPU, process peak resident memory, failure and timeout
rate, stage distributions, signed paired overhead, and retrieval/lifecycle/privacy
correctness. Prompts, outputs, credentials, and repository paths are excluded.
The source digest excludes only the generated report itself and rebuildable
`docs/knowledge/` projections; canonical source documents, code, configuration, lockfile,
and release intent remain bound.

The strict gates remain: no sample reaches 30 seconds; prompt p95 is at most 15 seconds;
eligible prompt p99 is at most 24 seconds; Stop p95 is at most 5 seconds; p95 does not
regress by more than 10 percent; and both arms have no execution or correctness failure.
There is no performance-exception branch in version 1.

## Consequences

Lervo can identify hook phases and expose the same stage meaning locally, through Hub
work trace, and in terminal coverage without coupling core execution to a provider or
dashboard. New stages require a catalog version. New harnesses can replace the fixture
adapter while retaining the same verified report contract.

Stage evidence proves elapsed Lervo work only. It does not prove provider acceptance,
model attention, correct learning, task correctness, whole-task usage, billed cost, or
an authorization decision. The checked evidence is observational for its bound source
and environment; future changes must regenerate it rather than treating old numbers as
current.

## References

- [ADR-0331](0331-adopt-reader-first-causal-work-observability.md)
- [ADR-0334](0334-project-provider-resources-into-one-work-report.md)
- [Foundation execution performance evidence](../../../evidence/foundation/execution-performance-v1.md)
- [Foundation delivery tracks](../../../roadmap/foundation-hardening/delivery-tracks.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
