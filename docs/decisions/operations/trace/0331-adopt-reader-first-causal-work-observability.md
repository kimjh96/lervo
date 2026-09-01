# ADR-0331: Adopt reader-first causal work observability

- Status: `accepted`
- Decision date: 2026-09-01

## Context

Lervo can report provider-normalized token snapshots inside managed adapters and can
measure isolated operations, but it cannot yet produce one trustworthy report for a
user request across retries, subagents, verification, query projection, and provider
turns. Existing event envelopes are strict version 1 contracts with a closed event-type
set. Adding event names while retaining version 1 would make old readers reject history
whose version they otherwise claim to support.

Foundation hardening therefore needs both causal coordinates and observability, but it
must not reinterpret old evidence, require a Hub, or imply that unavailable provider
work was observed.

## Decision

Introduce a reader-first event-envelope version 2 and a provider-neutral causal work
observability contract. The first reader tranche now implements the version 2 envelope
and payload-reading boundary; it does not claim that version 2 writers, capability
negotiation, or work reports already exist.

### Compatibility rollout

The rollout has four ordered states:

1. The pre-rollout baseline supports only envelope version 1 in readers and writers.
2. A reader release accepts mixed version 1 and version 2 history while continuing to
   write version 1.
3. Historical replay, local storage, sync, Node, Hub, diagnostics, and packed-CLI tests
   prove that reader release before any version 2 event is emitted.
4. An exact plan/apply operation changes the Lervo-managed
   `.lervo/data/event-contract.json` writer coordinate from 1 to 2.

The coordinate has its own schema version, records the selected event write version and
activation evidence, and is ignored by old writers. Activation is allowed only when
every configured reader advertises version 2 capability. Version 1 remains the default
for fresh repositories until the rollout decision changes through a later ADR.

The current implementation is at state 3. The in-process event contract, local SQLite
reader, synchronization validation, Hub storage, diagnostics, and trace readers consume
mixed history, and the installed packed CLI advertises the same reader capability and
reproduces an exact linked version 1/version 2 fixture. Production writers remain pinned
to version 1. The managed writer-coordinate operation, activation checks, recovery, and
rollout runbooks remain required before state 4.

`EventReaderCapabilitiesV1` is a provider-neutral, secret-free report with required
`schemaVersion: 1`, `capability: event_reader`, and a strictly ascending,
duplicate-free `readableEventSchemaVersions`. It deliberately contains no writable
version, activation approval, peer URL, repository coordinate, credential, or runtime
health claim. The local trace capability report and owner-only Node health snapshot
carry this same report. Hub exposes it at unauthenticated
`GET /v1/health/capabilities`, with the existing no-store and Hub-identity headers; the
sync HTTP adapter can read that identity-bound surface without sending its bearer
secret. Historical trace and Node health reports without this additive field remain
readable. An unsupported capability-report version and an invalid report have distinct
typed failures. Missing, invalid, unverified, or v2-incapable peer reports cannot
authorize a future v2 writer.

Writers never rewrite old events. A version 2 reader must accept a valid mixed chain. A
version 1-only reader encountering version 2 fails with a typed unsupported-version
error before mutation. After activation, rollback means a version 2-capable release
that can disable version 2 writing; it never means returning to a version 1-only reader.

### Causal work event

Envelope version 2 adds `work.causality.recorded`. Exactly one immutable event is
appended for each managed run before `run.requested`. Its payload contains:

- `workId` and `executionContractVersion`;
- `relationship`: `root`, `retry`, `repair`, `subagent`, `verification`,
  `publication_evaluation`, `deliberation`, or `improvement_evaluation`;
- nullable `parentRunId` and `retryOfRunId`;
- positive `attemptOrdinal`; and
- nullable `workstreamId`, `assignmentId`, and `agentId`.

The envelope `runId` is the child run. A root has no parent or retry coordinate and has
ordinal 1. Every non-root has a parent in the same work. A retry additionally identifies
the earlier run and increments its logical attempt ordinal. Failure to append valid
causality blocks managed provider start.

`workId` groups causally related execution. It does not create a new objective, task,
authority, memory, acceptance, or completion store. Historical version 1 runs project
as `legacy_unlinked`; readers do not invent ancestry.

### Resource observation event

Envelope version 2 adds `resource.usage.recorded`. The payload contains:

- `workId`, a unique `resourceObservationId`, and `sourceCoordinateDigest`;
- `scope`: `primary_provider`, `subagent_provider`, `query_projection`,
  `publication_evaluation`, `deliberation`, or `improvement_evaluation`;
- `source`: `provider_reported` or `lervo_measured`;
- `accountingMode`: `turn_cumulative`, `session_cumulative`, or `operation_delta`;
- `accountingDescriptorHash`;
- `status`: `observed`, `partial`, `unavailable`, or `invalid`;
- nullable `usage`; and
- nullable `reasonCode`.

When present, `usage` has non-negative `inputTokens`, `cachedInputTokens`,
`outputTokens`, `reasoningOutputTokens`, and `totalTokens`, plus nullable
`contextWindow`. Cached input is a subset of input, reasoning output is a subset of
output, and total equals input plus output. `observed` requires complete counts;
`partial` requires counts and a reason; `unavailable` and `invalid` require a reason and
prohibit fabricated counts.

Exact provider, model, service tier, native counter semantics, and normalization version
live in a local-only `ResourceAccountingDescriptorV1` CAS artifact bound by
`accountingDescriptorHash`. Events contain no credentials, prompts, outputs, or raw
provider responses.

Adapters declare accounting mode and descriptor, then normalize native observations.
The orchestrator deduplicates cumulative snapshots by their exact source coordinate and
emits the final canonical resource observation when the run settles. A cumulative
counter regression or inconsistent total is `invalid`, not silently corrected.

### Stage observation event

Envelope version 2 adds `execution.stages.observed`. One bounded set is preferred over
an event per span so that observation does not itself dominate hook latency. Its payload
contains:

- `executionMode`: `managed` or `unmanaged_terminal`;
- nullable `workId` and `terminalObservationId`;
- `observationSetId`, `stageCatalogVersion`, and `environmentProfileDigest`;
- `repositoryProfile`: `small`, `medium`, `large`, or `custom`; and
- at most 32 stage records.

Each stage record has a catalogued `stageId`, nullable `parentStageId`, monotonic
`durationMs`, nullable `budgetMs`, `outcome` (`completed`, `failed`, `cancelled`,
`timeout`, or `abstained`), and `coldState` (`cold`, `warm`, or `unknown`). Managed sets
require a work ID; terminal sets require a terminal observation ID. Prompt, query,
output, path, and credential bytes are prohibited.

Stage catalog version 1 covers ingress integrity, repository discovery, projection
admission, corpus preparation, search, selection, exact loading, context assembly,
event commit, provider start, context injection, provider turn, provider stop,
repository snapshot, verification, lifecycle inspection, and total duration. New stage
meanings require a catalog version rather than vendor-specific free-form names.

Managed append failure is a telemetry failure with typed report incompleteness. Terminal
stage persistence is atomic with the terminal observation; internal hook failure returns
the availability-safe empty response and never records a false success.

### Shared work report

Define `WorkExecutionReportV1` as a rebuildable projection for one managed `workId`. It
contains the linked run tree, resource observations grouped by scope and accounting
descriptor, stage summaries, completeness (`complete`, `partial`, `unavailable`, or
`invalid`), and typed missing reasons.

Provider or accounting-descriptor totals remain separate; the report never presents
cross-provider tokens as equivalent. Foundation scope does not estimate prices,
reconcile bills, or enforce monetary budgets. Cost disposition is explicitly
`unavailable` or `not_in_foundation_scope`.

The CLI exposes the projection through `lervo trace --work <work-id> [--json]`; local
diagnostics and Hub trace use the same pure projector. Direct terminal reporting states
that whole-task usage is unavailable and may separately show observed query-projection
usage from its existing receipt.

## Responsibility boundaries

- `@lervo/schemas` owns versioned envelopes, payloads, descriptors, and reports.
- `@lervo/event-contract` owns mixed-version validation, hashing, and redaction.
- `@lervo/execution-contract` owns pure causality, accounting, and stage invariants.
- A new `@lervo/execution-observability` package is created with its first projector
  artifact and owns only pure work-report projection.
- `@lervo/orchestrator` creates causal coordinates, aggregates adapter observations, and
  records monotonic stage timing.
- Provider adapters translate native accounting behind common contract tests.
- Terminal runtime records only bounded stages and usage it directly observes.
- Diagnostics and Hub consume the shared projector; CLI performs no storage projection.
- Storage, sync, Node, and Hub negotiate reader and writer capabilities without changing
  event meaning.

## Consequences

Lervo can eventually answer how much an observed managed request used and where time was
spent without claiming model self-learning, bill accuracy, or terminal observations it
does not possess. The reader-first migration costs an additional release phase, but it
protects historical evidence and makes rollback explicit. Governed loops and execution
graphs can later consume the same work coordinate; they are not part of this foundation
implementation.
