# ADR-0331: Adopt reader-first causal work observability

- Status: `accepted`
- Decision date: 2026-09-01

## Context

Lervo can report provider-normalized token snapshots inside managed adapters and measure isolated operations, but it cannot produce one trustworthy report for a user request across retries, subagents, verification, query projection, and provider turns. Existing event envelopes are strict version 1 contracts with a closed event-type set. Adding event names under version 1 would make old readers reject history whose version they claim to support.

Foundation hardening therefore requires causal coordinates and observability without reinterpreting old evidence, requiring a Hub, or implying observation of unavailable provider work.

## Decision

Introduce a reader-first event-envelope version 2 and a provider-neutral causal work observability contract. The first reader tranche implements the version 2 envelope and payload-reading boundary; it does not claim that version 2 writers, capability negotiation, or work reports already exist.

### Compatibility rollout

The rollout has four ordered states:

1. The baseline supports only envelope version 1 in readers and writers.
2. A reader release accepts mixed version 1/version 2 history while still writing version 1.
3. Historical replay, local storage, sync, Node, Hub, diagnostics, and packed-CLI tests prove that reader release before any version 2 event is emitted.
4. An exact plan/apply operation changes the Lervo-managed `.lervo/data/event-contract.json` writer coordinate from 1 to 2.

The coordinate has its own schema version, records the selected event write version and activation evidence, and is ignored by old writers. Activation requires every configured reader to advertise version 2 capability. Fresh repositories default to version 1 until a later ADR changes the rollout decision.

The reader release remains a default-writer-version-1 release. Its in-process event contract, local SQLite reader, synchronization validation, Hub storage, diagnostics, and trace readers consume mixed history. The installed packed CLI advertises the same reader capability and reproduces an exact linked version 1/version 2 fixture.

The state 4 mechanism supports local-only and Hub-enabled repositories through a versioned coordinate schema, bounded capability evidence, content-bound planning and exact apply, durable interruption recovery, explicit writer rollback, and an operational runbook. A missing coordinate selects version 1. Hub-enabled activation uses the existing owner-only Node fleet registry as complete configured membership and separately observes fresh, identity-bound Node and Hub capabilities during plan and apply. Capability advertisement never grants authority; see [ADR-0332](0332-authoritative-distributed-event-reader-inventory.md).

The resolved coordinate, not an individual event draft, selects the envelope version. After activation, the SQLite writer upgrades existing shared-version event drafts to version 2; immutable pre-activation version 1 retries remain idempotent. Version 2-only event types cannot pass the default version 1 writer.

`EventReaderCapabilitiesV1` is a provider-neutral, secret-free report requiring `schemaVersion: 1`, `capability: event_reader`, and strictly ascending, duplicate-free `readableEventSchemaVersions`. It contains no writable version, activation approval, peer URL, repository coordinate, credential, or runtime health claim. The local trace capability report and owner-only Node health snapshot carry the same report. Hub exposes it at unauthenticated `GET /v1/health/capabilities` with existing no-store and Hub-identity headers; the sync HTTP adapter reads that identity-bound surface without sending its bearer secret. Historical trace and Node health reports lacking this additive field remain readable. Unsupported capability-report versions and invalid reports have distinct typed failures. Missing, invalid, unverified, or version-2-incapable peer reports cannot authorize a future version 2 writer.

Writers never rewrite old events. A version 2 reader accepts a valid mixed chain. A version 1-only reader encountering version 2 fails with a typed unsupported-version error before mutation. After activation, rollback requires a version 2-capable release that disables version 2 writing; it never means returning to a version 1-only reader.

### Causal work event

Envelope version 2 adds `work.causality.recorded`. Exactly one immutable event is appended for each managed run before `run.requested`. Its payload contains:

- `workId` and `executionContractVersion`;
- `relationship`: `root`, `retry`, `repair`, `subagent`, `verification`, `publication_evaluation`, `deliberation`, or `improvement_evaluation`;
- nullable `parentRunId` and `retryOfRunId`;
- positive `attemptOrdinal`;
- nullable `workstreamId`, `assignmentId`, and `agentId`.

The envelope `runId` is the child run. A root has no parent or retry coordinate and has ordinal 1. Every non-root has a parent in the same work. A retry also identifies the earlier run and increments its logical attempt ordinal. Failure to append valid causality blocks managed provider start.

FH1 implements this writer invariant through [ADR-0333](0333-record-causal-work-before-managed-execution.md): causality and request admission are atomic, SQLite enforces unique run and root coordinates, deliberation uses one control root, and historical unlinked runs remain explicit rather than inferred.

`workId` groups causally related execution. It creates no objective, task, authority, memory, acceptance, or completion store. Historical version 1 runs project as `legacy_unlinked`; readers do not invent ancestry.

### Resource observation event

Envelope version 2 adds `resource.usage.recorded`. Its payload contains:

- `workId`, unique `resourceObservationId`, and `sourceCoordinateDigest`;
- `scope`: `primary_provider`, `subagent_provider`, `query_projection`, `publication_evaluation`, `deliberation`, or `improvement_evaluation`;
- `source`: `provider_reported` or `lervo_measured`;
- `accountingMode`: `turn_cumulative`, `session_cumulative`, or `operation_delta`;
- `accountingDescriptorHash`;
- `status`: `observed`, `partial`, `unavailable`, or `invalid`;
- nullable `usage` and `reasonCode`.

When present, `usage` has non-negative `inputTokens`, `cachedInputTokens`, `outputTokens`, `reasoningOutputTokens`, and `totalTokens`, plus nullable `contextWindow`. Cached input is a subset of input, reasoning output is a subset of output, and total equals input plus output. `observed` requires complete counts. `partial` requires counts and a reason. `unavailable` and `invalid` require a reason and prohibit fabricated counts.

Exact provider, model, service tier, native counter semantics, and normalization version reside in a local-only `ResourceAccountingDescriptorV1` CAS artifact bound by `accountingDescriptorHash`. Events contain no credentials, prompts, outputs, or raw provider responses.

Adapters declare their accounting mode and descriptor, then normalize native observations. The orchestrator deduplicates cumulative snapshots by exact source coordinate and emits the final canonical resource observation when the run settles. A cumulative-counter regression or inconsistent total is `invalid`, never silently corrected.

### Stage observation event

Envelope version 2 adds `execution.stages.observed`. One bounded set is preferred over an event per span so observation does not dominate hook latency. Its payload contains:

- `executionMode`: `managed` or `unmanaged_terminal`;
- nullable `workId` and `terminalObservationId`;
- `observationSetId`, `stageCatalogVersion`, and `environmentProfileDigest`;
- `repositoryProfile`: `small`, `medium`, `large`, or `custom`;
- at most 32 stage records.

Each stage record has a catalogued `stageId`, nullable `parentStageId`, monotonic `durationMs`, nullable `budgetMs`, `outcome` (`completed`, `failed`, `cancelled`, `timeout`, or `abstained`), and `coldState` (`cold`, `warm`, or `unknown`). Managed sets require a work ID; terminal sets require a terminal observation ID. Prompt, query, output, path, and credential bytes are prohibited.

Stage catalog version 1 covers ingress integrity, repository discovery, projection admission, corpus preparation, search, selection, exact loading, context assembly, event commit, provider start, context injection, provider turn, provider stop, repository snapshot, verification, lifecycle inspection, and total duration. New stage meanings require a catalog version, not vendor-specific free-form names.

Managed append failure is a telemetry failure with typed report incompleteness. Terminal-stage persistence and its availability-safe failure meaning are implemented and refined by [ADR-0335](0335-record-and-verify-bounded-execution-stage-evidence.md); failure never records false stage success or changes terminal execution authority.

### Shared work report

Define `WorkExecutionReportV1` as a rebuildable projection for one managed `workId`. It contains the linked run tree, resource observations grouped by scope and accounting descriptor, stage summaries, completeness (`complete`, `partial`, `unavailable`, or `invalid`), and typed missing reasons.

Provider or accounting-descriptor totals remain separate; the report never presents cross-provider tokens as equivalent. Foundation scope neither estimates prices, reconciles bills, nor enforces monetary budgets. Cost disposition is explicitly `unavailable` or `not_in_foundation_scope`.

The CLI exposes the projection through `lervo trace --work <work-id> [--json]`; local diagnostics and Hub trace use the same pure projector. Direct terminal reporting states that whole-task usage is unavailable and may separately show observed query-projection usage from its existing receipt.

## Responsibility boundaries

- `@lervo/schemas` owns versioned envelopes, payloads, descriptors, and reports.
- `@lervo/event-contract` owns mixed-version validation, hashing, and redaction.
- `@lervo/execution-contract` owns pure causality, accounting, and stage invariants.
- A new `@lervo/execution-observability` package begins with its first projector artifact and owns only pure work-report projection.
- `@lervo/orchestrator` creates causal coordinates, aggregates adapter observations, and records monotonic stage timing.
- Provider adapters translate native accounting behind common contract tests.
- Terminal runtime records only bounded stages and usage it directly observes.
- Diagnostics and Hub consume the shared projector; CLI performs no storage projection.
- Storage, sync, Node, and Hub negotiate reader and writer capabilities without changing event meaning.
- `@lervo/project` owns pure writer-selection policy, the bounded coordinate store, and durable selection recovery. Project storage only injects the resolved version into the event-store adapter; CLI owns parsing and presentation.

## Consequences

Lervo can eventually report how much an observed managed request used and where time was spent without claiming model self-learning, bill accuracy, or unavailable terminal observations. The reader-first migration adds a release phase but protects historical evidence and makes rollback explicit. Governed loops and execution graphs may later consume the same work coordinate; they are outside this foundation implementation.
