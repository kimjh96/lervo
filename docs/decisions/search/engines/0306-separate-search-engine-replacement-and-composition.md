# ADR-0306: Separate search-engine replacement from retrieval composition

Status: `accepted`
Date: 2026-08-30

## Context

ADR-0302 directs future retrieval improvements through `SearchEnginePort`, not another post-search context exception. The current port, static candidate registry, build-bound comparison, reviewed activation, fail-closed resolver, and lexical rollback support deterministic whole-engine replacement.

The next scope also requires external-only retrieval and an external engine that augments or reranks a future `lexical-v2`. Opaque engines would conceal which stages ran, what data left the repository, which stage failed, and whether a reranker recovered a missing source. Runtime dynamic imports would make replacement unreviewed code execution.

Contemporary retrieval systems distinguish parallel retrieval, fusion, and phased reranking. The accompanying [research](../../../research/extensible-search-engine-architecture.md) compares local FTS, hybrid engines, rank fusion, learned sparse retrieval, and late interaction.

## Decision

Preserve `SearchEnginePort` and `SearchIndexPort` v1 for the current baseline and deterministic single-engine candidates. Add future extensibility through a versioned retrieval plan above those ports with this bounded shape:

```text
1..3 retrieve stages -> 0..1 fusion stage -> 0..1 rerank stage
```

This contract is not a general DAG. Retrieve stages may be local or external. Fusion consumes ordered source coordinates; its first implementation uses deterministic rank-based fusion. Reranking receives a bounded set of registered candidates and may reorder or drop them, but cannot introduce sources.

Register the cohesive `search.engines` decision route at `docs/decisions/search/engines`. Keep engine and composition contracts there. The parent search route retains candidate evaluations, selection, and natural-language retrieval experiments.

External replacement, local replacement, local-plus-external augmentation, and external reranking are distinct complete plan candidates. Bind each plan to its stage descriptors, adapter builds, configurations, data classes, candidate depths, final limit, environment target, and failure policy. Raw task wording and question categories must not select or alter a plan.

Separate v2 index preparation from query execution. An immutable preparation receipt binds the canonical corpus digest, adapter build, engine configuration, analyzer or model coordinates, external generation, document count, and readiness. Query execution requires that exact receipt. Changed coordinates fail closed until preparation is repeated.

Every stage returns a privacy-bounded execution receipt containing stage and adapter identity, input digest, bounds, duration, terminal status, and ordered result digest. Stage receipts do not prove relevance, selection, loading, injection, correctness, or provider use. Final response validation accepts only current registered source coordinates.

Built-in adapters may run in process. Separately installed third-party adapters use a versioned out-of-process protocol and exact installation lock. Never resolve a module, package, path, or URL dynamically from a query. Configuration names an environment target and contains neither credentials nor mutable endpoint truth. Search adapters have their own installation kind; they are not provider skills, MCP servers, or plugins.

External data authority is explicit for source bodies, source metadata, query text, candidate bodies, and vectors. Network, credential, retention, indexing, query, and cost authority remain separate. Rollback does not imply deletion of an external index.

Failure of a required stage makes the selected plan unavailable. Do not silently omit stages, mix in another engine, use a stale index, or fall back. Reduced or degraded composition is a separate reviewed plan. Preserve explicit rollback to the independently available `lexical-v1` baseline.

Exact deterministic replay remains the initial activation class. An approximate or hosted engine without snapshot-isolated exact responses requires a later observational-engine decision and repeated statistical gates; it cannot weaken the current replay contract.

This decision authorizes only contract specification, local implementation, fixture adapters, and provider-free external prototypes. It does not authorize production activation, live credentials, corpus export, external retention, network calls, or quality claims.

## Lexical-v2 order

Keep `bm25f-v1` as the comparison control. The first new local candidate evaluates field-aware Unicode word BM25F, identifier-aware token splitting, character n-gram retrieval, and deterministic rank fusion. It contains no language-specific keyword, alias, synonym, translation, confidence, or question-category routing.

Compare `lexical-v1`, `bm25f-v1`, and the new candidate using the same current corpus and reviewed Korean, English, mixed-language, exact-identifier, morphology, multi-source, ambiguous-neighbor, and no-hit cases. Require per-task no-regression evidence. Measure build, warm-query, cold-start, index-byte, and memory costs separately.

After the local comparison, implement one out-of-process fixture and one provider-free external replacement prototype. Evaluate augmentation and reranking as separate candidates. Never credit a reranker with recall for sources absent from its bounded input.

## Consequences

Lervo gains one evidence model for local, external-only, and composed retrieval without importing vendor SDKs into core search or conflating ranking stages with context delivery. Installation remains deliberate and reproducible instead of allowing arbitrary runtime code loading.

Plan and receipt types require more work than placing a remote SDK behind the current port, but preserve stage-level privacy, cost, failure, and replay meaning. No new engine becomes operational before its comparison, review, activation, and rollback evidence passes.

## Verification required by implementation

- Common stage-adapter tests cover identity, bounds, current registered sources, privacy, timeouts, cancellation, malformed output, stale receipts, and input immutability.
- Pipeline tests cover external-only operation, augmentation, reranking, required-stage failure, no silent fallback, deterministic fusion, and explicit baseline rollback.
- Installation tests reject arbitrary modules, paths, URLs, mutable locks, incompatible protocols, and undeclared network or data classes.
- External fixture tests confirm that canonical telemetry exposes no credentials, source bodies, query text, native scores, or vendor responses.
- Candidate evaluation preserves existing corpus and case bindings and records stage-specific latency, cost, and failure evidence.
- Implementation still requires documentation lifecycle, knowledge refresh, and release-completion checks.

## References

- [Extensible search-engine research](../../../research/extensible-search-engine-architecture.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)
- [Policy-bound search-engine selection](../0060-policy-bound-search-engine-selection.md)
- [Operational engine resolution](../0061-fail-closed-operational-search-engine-resolution.md)
- [Adapter build identity](../0063-search-adapter-build-identity-and-replay-receipt.md)
- [Linked-default retirement](../activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
- [Lexical-v2 evaluation disposition](0307-revise-lexical-v2-after-local-and-provider-evaluation.md)
