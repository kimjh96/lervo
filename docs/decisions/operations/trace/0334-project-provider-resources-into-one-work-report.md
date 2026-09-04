# ADR-0334: Project provider resources into one work report

- Status: `accepted`
- Decision date: 2026-09-01

## Context

FH1 established causal work coordinates, but native Codex and Claude usage remained adapter-local. Repeated cumulative notifications could be double-counted, direct terminal receipts could be mistaken for whole-task usage, and independent local and Hub aggregation could drift semantically.

## Decision

Every managed adapter declares one versioned `ResourceAccountingDescriptorV1` containing provider, adapter version, accounting mode, normalization identity, native-counter semantics, optional model and service tier, and exact observation support. Descriptor bytes are canonical local CAS artifacts; the event retains only their content hash. Codex and Claude currently declare turn-cumulative provider-reported accounting. The accounting declaration is a sibling `ProviderAdapter` contract, not an extension of the historical adapter-message descriptor, so resource evolution neither rewrites the claim-eligibility boundary nor couples message capability validation to accounting policy.

`@lervo/execution-contract` owns a provider-neutral accumulator. It replaces a cumulative coordinate with its latest monotonic snapshot, admits an operation delta once by event identity, and rejects regression, inconsistent arithmetic, or contradictory identity with a typed invalid result. It never derives price or billed cost.

The orchestrator persists the descriptor before approval or provider startup, observes only normalized adapter events, and records one final `resource.usage.recorded` event immediately before `run.completed` or `run.failed`. A managed run with no usable native counter records `resource_observation_missing`; an adapter that explicitly lacks support uses its declared reason. Descriptor-storage failure records no dangling resource event.

`@lervo/execution-observability` owns the pure `WorkExecutionReportV1` projector. It groups by provider, scope, source, accounting mode, and descriptor hash. Totals never cross those boundaries. Missing stage evidence remains explicit until FH3. Cost is `not_in_foundation_scope`.

Local `lervo trace --work <work-id> [--json]` and Hub `GET /v1/trace/projects/:projectId/works/:workId` invoke the same projector. Hub reads a bounded synchronized event source; neither surface maintains an alternate report store.

Direct terminal coverage reports whole-task provider usage as unavailable with `unmanaged_provider_usage_unobserved`. If the existing query-projection receipt contains usage, it is reported separately as partial with `accounting_descriptor_unavailable`; absence is `query_projection_usage_unavailable`. This does not upgrade hook preparation to managed execution or provider use.

## Privacy and failure meaning

Descriptors and observations exclude prompts, query text, outputs, reasoning, paths, credentials, raw native responses, price catalogs, and invoices. Counters prove only the declared normalized observation. `observed` does not prove correctness, task completion, provider understanding, billed usage, or model learning. Missing counters are never zero-filled, and contradictions are never silently repaired.

## Consequences

Current Codex and Claude managed paths can produce one replayable resource view for a causal request, while unsupported paths retain exact limitations. New providers can add accounting behind the descriptor and common contract without changing orchestration, CLI, or Hub semantics. FH3 can add bounded stage sets to the existing report without moving timing policy into this resource ledger.

## References

- [ADR-0331](0331-adopt-reader-first-causal-work-observability.md)
- [ADR-0333](0333-record-causal-work-before-managed-execution.md)
- [Foundation-hardening delivery tracks](../../../roadmap/foundation-hardening/delivery-tracks.md)
- [Execution events and privacy](../../../specifications/execution/events-and-privacy.md)
- [Provider adapter specification](../../../specifications/execution/provider-adapters.md)
