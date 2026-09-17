# Surface observability

## Evidence authority

Discord and future first-party surfaces consume existing causal work, context coverage, resource, stage, search, normalization, state-retention, verification, and delivery evidence. They must not create a second telemetry vocabulary or reinterpret historical observations.

`SurfaceObservabilityReportV1` is a rebuildable application projection with required fields defined by [application projections](application-projections.md). It joins only exact compatible coordinates and preserves every source status, descriptor, and missing reason. It adds no canonical event and does not make presentation state durable truth.

## Report sections

The projection exposes each section independently:

- `grounding`: counts and coordinates for recommended, selected, loaded, injected, and referenced documents; separate delivery, reference, relevance, and selection coverage. Unknown denominators remain `null` with a reason.
- `search`: resolved engine, version, adapter build, qualification or selection transition, source revision, preparation state, query duration, ordered hit coordinates, and fail-closed status.
- `resources`: exact provider, causal scope, accounting mode, descriptor hash, observation status, and input, cached-input, output, reasoning-output, and total tokens. Groups remain separate.
- `stages`: catalog version, environment profile, repository profile, cold state, bounded occurrence count, outcome, and monotonic duration for each observed stage.
- `caches`: typed observations from existing owners, including provider cached-input tokens, repository projection cold or warm state, document-normalization hit and miss counts, provider-call count for cache-only normalization, and rebuildable-state inventory bytes when observed.
- `result`: separate verification, acceptance, artifact, origin-bound publication, and transport-delivery states, never one completion flag.
- `deliberation`: policy and participant coordinates, rounds, artifact kinds, objections, verification, convergence or `no_consensus`, publication attempts, and origin delivery. Each provider role, verification, and writing evaluation retains its own causal resource group.
- `completeness`: `complete`, `partial`, `unavailable`, or `invalid`, with typed reasons per section.

`cachedInputTokens` is a subset of provider input tokens, not a cache byte count, discount, cost, or saving. Projection-cache reuse, document-normalization cache reuse, and derived-state bytes are distinct observations: never sum them or present them as one unlabeled cache number.

## Correlation and comparison

The report binds a surface origin to existing work, run, conversation, assignment, result, and delivery coordinates. Surface identity is a comparison dimension, not a new causal root or resource scope. Retries, subagents, verification, publication evaluation, deliberation, and improvement evaluation retain existing causal relationships and accounting scopes.

Ordinary conversation and formal deliberation are different task modes. Compare their resource use only when the report proves an equivalent decision objective, source revision, participants, verification, and acceptance. Deliberation overhead remains visible; it must not be charged to the originating conversation turn or collapsed into one provider total.

Compare Discord, local CLI, managed supervision, and future first-party journeys only when the report proves compatible task input, repository revision, provider and model, accounting descriptor, search plan, environment profile, verification, and acceptance criteria. Otherwise, the UI shows separate observations and names the incompatibility.

Dashboards must not:

- Combine tokens across providers, descriptor hashes, accounting modes, or causal scopes.
- Convert missing usage, cache, coverage, or timing observations to zero.
- Infer billing cost from tokens without a separately versioned price observation.
- Infer document understanding from injection or a result marker.
- Count transport acknowledgment as result delivery or task completion.
- Reuse a cache or projection after its bound source revision or adapter build changes.

## Collection and performance

Instrumentation reuses existing stage recorders and resource adapters. Rendering and export add no provider call and stay outside the measured provider interval. New observation work records its own bounded overhead and cannot fail a successful product action unless the owning contract already requires that observation for authority or a configured budget.

Long-running hosts retain at most the current and one in-flight repository projection revision. Activity and observability queries use bounded cursors, pagination, and retention. Cache inventories follow typed derived-state pruning, protecting current projections, pending reviews, and recovery-required state.

## Privacy and failure meaning

Reports may contain opaque coordinates, hashes, provider and adapter identifiers, normalized counts, durations, profiles, statuses, and reason codes. They exclude prompts, raw messages, outputs, reasoning, unrestricted paths, document bodies, credentials, native provider payloads, and private platform identifiers.

Invalid or contradictory evidence makes only the affected section `invalid`. Missing optional observation is `unavailable`; incomplete required members are `partial`. Surfaces preserve these states and never repair telemetry from prose, current filesystem guesses, or a later provider call.

## Acceptance

Common product-surface fixtures must prove that Discord, CLI, supervision, and the future first-party host render the same underlying evidence without changing counts or meanings. Installed Discord acceptance additionally verifies:

- One cold and one revision-matched warm journey.
- Exact document coverage stages.
- Provider token and cached-token availability behavior.
- Cache hit and miss ownership.
- Stage timing, verification, and result delivery.
- Deliberation role, round, artifact, token, cache, verification, terminal, and origin-delivery separation for the optional formal decision journey.

Restart must neither double-count observations nor lose an explicitly unavailable status.

## References

- [Reader-first causal work observability](../../../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md)
- [Stage observation and performance](../stage-observation-and-performance.md)
- [Resource and performance budgets](../resource-and-performance-budgets.md)
- [Managed context coverage](../lifecycle-and-context/context-evidence/coverage-and-summaries.md)
- [Repository knowledge query](../../../specs/repository-knowledge-query.md)
- [Typed derived-state retention](../../../decisions/operations/storage/0219-typed-derived-state-retention.md)
