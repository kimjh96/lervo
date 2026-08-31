# Extensible lexical and external search-engine research

Status: `accepted architecture; lexical-v2 engineering-qualified for activation review`  
As of: 2026-08-31

## Evaluation question

How should Lervo support a stronger `lexical-v2`, an external engine as the sole operational retriever, and an external engine that augments or reranks local retrieval without weakening local-first recovery, source authority, privacy, or search evidence?

This architecture activates no external engine, model, fusion service, or reranker. [ADR-0318](../decisions/search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md) records that the newer lexical-v2 build passed its local and cross-provider engineering gates and is eligible for authorized activation review without becoming an implicit default.

## First experiment outcome

The deterministic lexical-v2 candidate passed replay and improved aggregate local ranking and warm-query latency, but failed the existing per-task activation threshold. Its local build was about 2.3 times slower. Across 24+24 valid Codex observations, answer pass count and recall were unchanged; precision fell slightly, reported tokens rose 0.55%, and total duration rose 9.26%. Claude could not support an eligible paired engine comparison because only 3/24 baseline and 6/24 candidate results passed the output contract.

Five of eight provider cases selected identical top-three documents, and the candidate supplied 0.87% more source bytes overall. Rank-score changes cannot save 10% of provider tokens while the next layer injects the same number of whole documents. Token reduction requires a separate, observable section-selection or compression stage. The exact [evidence](../evidence/search/lexical-v2/lexical-v2-local-and-provider-comparison-v1.md) rejects activation and combined speed-and-accuracy or token-saving claims.

The strengthened candidate later passed augmented English and Korean local quality gates and reduced the frozen provider evidence envelope to 37.65% of baseline bytes. A final Korean local rerun put build p95 at 3.05 times baseline, above the unchanged 3.00-times cost bound. In the final twelve-case confirmation, Codex reduced reported tokens by 15.09% and improved recall and precision, but regressed one previously uncalled case and reduced duration by only 2.98%. Claude reduced tokens by 40.99% and duration by 6.77%, but native structured output appeared as tool activity and invalidated every arm under the preregistered zero-tool contract. The [v12 evidence](../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v12.md) therefore retains lexical-v1 without lowering a gate.

## Current Lervo boundary

Lervo supports deterministic whole-engine replacement:

- `SearchEnginePort` builds one index from a bounded canonical corpus.
- `SearchIndexPort` returns one ranked response.
- A static registry binds candidate, engine, version, and `adapterBuildId`.
- Paired comparison, review, immutable activation, runtime replay, explicit rollback, and the independently available local `lexical-v1` baseline protect operational selection.

The registered `bm25f-v1` candidate proves this path. The boundary does not support general external or composed retrieval:

- The CLI statically imports candidates; separately released adapters cannot be installed.
- `buildIndex(sources)` assumes one-process rebuild and replay. Persistent or remote engines need explicit synchronization, readiness, generation, and retention semantics.
- One opaque response cannot reveal whether local retrieval, remote retrieval, fusion, or reranking ran.
- Responses require positive safe-integer scores and exact repeated ordering. External engines often use floating-point scores, while distributed or approximate engines may not replay exactly.
- The port cannot independently authorize source-body export, query-text export, candidate-only export, a network target, or external cost.

## External systems and research findings

The reviewed systems, papers, and Lervo implications are maintained in the [search-engine landscape](extensible-search-engine-landscape.md). They favor explicit multi-stage retrieval with bounded candidate sets, independently configurable representations, and evaluation of the complete pipeline—not one universally winning engine.

## Selected architecture direction

### Keep replacement and composition separate

Retain the v1 ports for compatible deterministic single-engine candidates. Add a versioned retrieval-plan boundary above them instead of widening one adapter to own unrelated behavior.

A bounded plan has this fixed shape:

```text
one or more retrieve stages
  -> optional deterministic fusion
  -> optional bounded rerank
  -> canonical response validation
```

The initial contract permits at most three retrievers, one fusion stage, one reranker, and 50 final hits. It is not a general DAG or agent workflow.

- External replacement: one external retrieve stage supplies all operational results; local results are not silently mixed in.
- Local replacement: `lexical-v2` replaces `lexical-v1` only after the existing evidence chain passes.
- Augmentation: `lexical-v2` and external retrieval feed fusion. Both may improve recall; stage identity and final fusion remain observable.
- Reranking: `lexical-v2` feeds external reranking. Only a bounded candidate subset leaves the local ranker, limiting disclosure and cost. Reranking can improve order, not first-stage recall.
- Hybrid plus reranking: local and external retrieval feed fusion and then external reranking. This has the largest cost, privacy, and failure surface.

Each complete plan is one activation candidate with its own identity. Runtime must not derive plans from raw task wording or switch stages by query category.

### Define stage-specific contracts

A retrieve stage owns index synchronization and candidate ranking. Fusion receives only source coordinates and ordered ranks. Reranking receives a bounded set of registered candidates and may reorder or drop them, but cannot introduce a new source.

Every stage result binds:

- stage, adapter, engine, implementation build, and configuration digests;
- canonical corpus snapshot or input candidate-set digest;
- external index generation or local index identity;
- requested and returned bounds;
- terminal status, duration, and privacy class;
- a result digest over ordered source coordinates.

Stage receipts prove only observed adapter preparation or execution—not relevance, selection, loading, injection, correctness, or provider use.

Final ranking must use ordered source coordinates rather than comparable vendor scores. Native scores may affect adapter-local ranking but remain outside canonical telemetry. Initial fusion uses deterministic rank-based RRF. Score normalization or learned fusion requires a separate candidate and evidence.

### Separate index lifecycle from query execution

For external engines, replace `buildIndex` with an explicit prepare or synchronize operation returning an immutable index receipt. It binds the canonical corpus digest, adapter build, engine configuration, analyzer or model coordinates, external generation, document count, and readiness observation.

A query must present the exact receipt. Any corpus, configuration, model, adapter, target, or external-generation change makes the engine unavailable until preparation completes again. External deletion and retention are separate effects and are never implied by rollback.

Deterministic local adapters may prepare in memory and preserve the current fast path.

### Install adapters; do not load arbitrary code at query time

“Easy to swap” means declarative, content-bound installation and selection—not resolving an npm package, filesystem path, URL, or dynamic import from a search command.

Built-in adapters may remain in process. Third-party adapters use a versioned out-of-process protocol and exact installation lock. A descriptor declares protocol version, adapter build, supported stage roles, determinism class, configuration schema, data classes, and required network capability. External connection details resolve through an environment target; tracked configuration contains neither credentials nor mutable endpoint truth.

Capability-package validation and locking may supply reusable mechanics, but a search adapter is core execution infrastructure—not a provider skill, MCP server, or plugin activation. It needs its own kind and authority boundary.

### Make privacy and failure semantics part of the plan

An external plan independently declares whether it may send:

- canonical source bodies for indexing;
- source metadata and content hashes;
- raw query text;
- locally retrieved candidate bodies for reranking;
- model-generated vectors.

The plan also declares its environment target, network authority, retention class, query and indexing budgets, and cost-observation policy. Credentials remain runtime-only.

Any required-stage failure makes the selected plan unavailable. Lervo must not silently omit a failed stage, mix in `lexical-v1`, or reuse a stale external index. A reduced plan is a distinct reviewed candidate and transition. Explicit rollback restores `lexical-v1` without requiring the external target.

## Lexical-v2 experiment direction

Do not rename the existing BM25F-inspired candidate to `lexical-v2`; retain it as a comparison control. A new local candidate tests this deterministic ensemble:

1. Unicode word BM25F over title, path, labels, and body.
2. Identifier-aware splitting for path segments, camel case, snake case, digits, and punctuation boundaries.
3. Character n-gram retrieval for identifiers, spelling variation, and morphology.
4. Deterministic rank fusion of the word and character branches.

The candidate must not add language-specific keywords, aliases, synonyms, translations, or question-category routing. Reviewed document labels may remain corpus fields because they are canonical source metadata. Cross-language semantic recall belongs to a separately identified external or local semantic retriever.

The first paired suite compares `lexical-v1`, `bm25f-v1`, and the new candidate on the same current corpus. It covers Korean, English, mixed-language, exact-identifier, morphology, multi-source, ambiguous-neighbor, and no-hit cases. Quality gates remain per task type and allow no reviewed baseline regression. Measure build time, warm-query time, index bytes, memory, and cold-start cost separately.

The local comparison and cross-provider engineering confirmation are complete. Lexical-v2 is eligible for authorized activation review, while operational selection still requires human-reviewed repository cases and the immutable transition chain. Before a live external prototype, implement a provider-free out-of-process fixture. The first semantic prototype must test multilingual external-only replacement separately from section-scoped evidence efficiency. Evaluate augmentation and reranking as distinct experiments so failures remain attributable.

## Counterarguments and limits

- A universal plugin API is premature. Evidence supports one fixed pipeline shape, not arbitrary stage graphs, query rewriting, remote corpus ownership, or provider-agent retrieval.
- External-only operation is valid only as an explicit selected mode. Keep the local baseline installed for comparison and offline rollback even when it contributes no results.
- Hiding fusion or reranking inside an “external engine” adapter prevents stage-level privacy, cost, and failure evidence; reviewed activation must reject it.
- Reranking cannot recover documents excluded by the first retriever.
- Neural or hybrid branding is not quality evidence. Model updates, hosted-service changes, approximate indexes, and score normalization can alter behavior without source changes.
- Exact reproducibility remains the initial activation requirement. Engines without snapshot-isolated exact responses require a later observational-engine contract with repeated statistical gates; by default, they must not weaken the deterministic chain.

## Bounded delivery order

1. Specify retrieval plans, stage descriptors, index receipts, execution receipts, privacy classes, and failure codes.
2. Implement and compare deterministic local `lexical-v2`. Completed; ADR-0318 qualifies the v20 build for authorized activation review after both providers passed.
3. Bind one common native structured-output carrier for Codex and Claude evaluation. Completed; both providers passed the v20 zero-tool and contract gates.
4. Specify section-scoped evidence selection and loss-bounded compression as a stage distinct from retrieval. Completed for evaluation; production composition remains inactive.
5. Add install-time out-of-process adapter discovery with a fixture adapter and contract tests.
6. Add one multilingual external-replacement prototype against a repository-owned test service without production activation.
7. Evaluate local-plus-external RRF as a distinct candidate.
8. Evaluate bounded external reranking only when first-stage recall is adequate.

Production activation, real external credentials, corpus export, and network calls require their existing separate authorities and fresh reviewed evidence.

## Related Lervo contracts

- [Search and context boundaries](../architecture/search-and-context.md)
- [Fail-closed operational search-engine resolution](../decisions/search/0061-fail-closed-operational-search-engine-resolution.md)
- [Search-adapter build identity](../decisions/search/0063-search-adapter-build-identity-and-replay-receipt.md)
- [Linked-default retirement](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
- [Replacement and composition decision](../decisions/search/engines/0306-separate-search-engine-replacement-and-composition.md)
- [Natural-language grounding quality](../roadmap/natural-language-grounding-quality.md)
