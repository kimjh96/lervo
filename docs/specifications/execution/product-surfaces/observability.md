# Surface observability

## Evidence authority

Discord and future first-party surfaces consume existing causal work, context coverage, resource, stage, search, normalization, state-retention, verification, and delivery evidence. They must not introduce a second telemetry vocabulary or reinterpret historical observations.

`SurfaceObservabilityReportV1` is a rebuildable application projection whose required fields are defined by [application projections](application-projections.md). It joins only exact compatible coordinates, preserves every source status, descriptor, and missing reason, adds no canonical event, and does not make presentation state durable truth.

## Report sections

Expose each section independently:

| Section | Evidence |
| --- | --- |
| `grounding` | Recommended, selected, loaded, injected, and referenced document counts and coordinates; separate delivery, reference, relevance, and selection coverage. Unknown denominators remain `null` with a reason. |
| `search` | Resolved engine, version, adapter build, qualification or selection transition, source revision, preparation state, query duration, ordered hit coordinates, fail-closed status. |
| `resources` | Exact provider, causal scope, accounting mode, descriptor hash, observation status, input, cached-input, output, reasoning-output, total tokens. Groups remain separate. |
| `stages` | Catalog version, environment profile, repository profile, cold state, bounded occurrence count, outcome, monotonic duration for each observed stage. |
| `caches` | Typed observations from existing owners: provider cached-input tokens, repository projection cold or warm state, document-normalization hit and miss counts, provider-call count for cache-only normalization, rebuildable-state inventory bytes when observed. |
| `result` | Separate verification, acceptance, artifact, origin-bound publication, and transport-delivery states; never one completion flag. |
| `deliberation` | Policy and participant coordinates, rounds, artifact kinds, objections, verification, convergence or `no_consensus`, publication attempts, origin delivery. Each provider role, verification, and writing evaluation retains its own causal resource group. |
| `completeness` | `complete`, `partial`, `unavailable`, or `invalid`, with typed reasons per section. |

`cachedInputTokens` is a subset of provider input tokens, not cache bytes, discount, cost, or saving. Projection-cache reuse, document-normalization cache reuse, and derived-state bytes are distinct: never sum them or show one unlabeled cache number.

## Correlation and comparison

Bind surface origin to existing work, run, conversation, assignment, result, and delivery coordinates. Surface identity is a comparison dimension, not a new causal root or resource scope. Retries, subagents, verification, publication evaluation, deliberation, and improvement evaluation retain existing causal relationships and accounting scopes.

Ordinary conversation and formal deliberation are distinct task modes. Compare resources only with proven equivalent decision objective, source revision, participants, verification, and acceptance. Keep deliberation overhead visible; never charge it to the originating conversation turn or collapse it into one provider total.

Compare Discord, local CLI, managed supervision, and future first-party journeys only with proven compatible task input, repository revision, provider and model, accounting descriptor, search plan, environment profile, verification, and acceptance criteria. Otherwise show separate observations and name the incompatibility.

Dashboards must not:

- Combine tokens across providers, descriptor hashes, accounting modes, or causal scopes.
- Convert missing usage, cache, coverage, or timing observations to zero.
- Infer billing cost from tokens without a separately versioned price observation.
- Infer document understanding from injection or a result marker.
- Count transport acknowledgment as result delivery or task completion.
- Reuse caches or projections after bound source revision or adapter build changes.

## Collection and performance

Reuse existing stage recorders and resource adapters. Rendering and export add no provider calls and remain outside measured provider intervals. New observation work records its own bounded overhead and cannot fail successful product actions unless the owning contract requires that observation for authority or a configured budget.

Long-running hosts retain at most the current and one in-flight repository projection revision. Activity and observability queries use bounded cursors, pagination, and retention. Cache inventories follow typed derived-state pruning while protecting current projections, pending reviews, and recovery-required state.

## Privacy and failure meaning

Reports may contain opaque coordinates, hashes, provider and adapter identifiers, normalized counts, durations, profiles, statuses, and reason codes. Exclude prompts, raw messages, outputs, reasoning, unrestricted paths, document bodies, credentials, native provider payloads, and private platform identifiers.

Invalid or contradictory evidence makes only the affected section `invalid`. Missing optional observations are `unavailable`; incomplete required members are `partial`. Surfaces preserve these states and never repair telemetry from prose, current filesystem guesses, or later provider calls.

## Acceptance

Common product-surface fixtures must prove that Discord, CLI, supervision, and the future first-party host render the same underlying evidence without changing counts or meanings. Installed Discord acceptance also verifies:

- One cold journey and one revision-matched warm journey.
- Exact document coverage stages.
- Provider token and cached-token availability behavior.
- Cache hit and miss ownership.
- Stage timing, verification, and result delivery.
- Deliberation role, round, artifact, token, cache, verification, terminal, and origin-delivery separation for the optional formal decision journey.

Restart must neither double-count observations nor lose explicitly unavailable status.

## References

- [Reader-first causal work observability](../../../decisions/operations/trace/0331-adopt-reader-first-causal-work-observability.md)
- [Stage observation and performance](../stage-observation-and-performance.md)
- [Resource and performance budgets](../resource-and-performance-budgets.md)
- [Managed context coverage](../lifecycle-and-context/context-evidence/coverage-and-summaries.md)
- [Repository knowledge query](../../../specs/repository-knowledge-query.md)
- [Typed derived-state retention](../../../decisions/operations/storage/0219-typed-derived-state-retention.md)
