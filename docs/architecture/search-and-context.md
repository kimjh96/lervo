# Search and context boundaries

Status: `active`
As of: 2026-09-01

## Evidence boundary

Search recommends but does not prove use. Selection records why an item was chosen; loading validates current bytes; delivery creates an adapter receipt before `injected` evidence exists. Later reference or use requires separate provider telemetry.

`selected`, `loaded`, `injected`, and `used` are distinct states. Engine results cannot prove delivery, reference, correctness, or provider use.

## Engine boundary

Operational retrieval uses `SearchEnginePort` and `SearchIndexPort`; `lexical-v1` is the local baseline. Engine adapters own only indexing and ranking. Corpus acquisition, query grounding, context selection, provider delivery, credentials, and network authority remain outside these ports.

The registered `lexical-v2` build `sebuild_e9f2ac9398b0f58d03143e7a` passed the v20 local and cross-provider engineering gates. A provider-neutral projection and independent-query fusion plan also passed all four exact human-reviewed real-use cases for both providers. ADR-0321 adds immutable complete-plan selection above the compatibility engine chain. It binds current projector populations, retriever build, fusion, corpus, review, policy, transition, and rollback instead of representing the dynamic plan as one deterministic engine.

Any other local engine or external adapter must:

1. Implement the provider-neutral port with distinct engine identity and content-bound adapter build identity.
2. Register in the bounded registry; registration has no runtime effect.
3. Be compared with `lexical-v1` on the same corpus and cases.
4. Have quality, latency, privacy, and cost evidence reviewed.
5. Be activated through an immutable policy-bound transition.
6. Revalidate its adapter build, corpus, comparison, review, index, and response during every operational resolution.
7. Roll back explicitly to `lexical-v1` when required by the reviewed transition.

Selected-adapter failure is fail-closed: runtime must not silently mix engines or fall back. Explicit rollback restores the local baseline without a Hub, external credential, or network service.

External engines belong in adapter packages. Core search, context, and provider orchestration must not import vendor SDKs or depend on Codex or Claude behavior. Credentials and network capability require separate authorization; secret bytes remain runtime-only.

Reranking, query expansion, remote corpora, and context expansion require separate measurable, observable boundaries. They must not be hidden inside an engine adapter to bypass comparison or review.

### V2 composition layer

ADR-0306 permits this bounded v2 composition layer above the compatibility ports:

```text
0..1 query-projection stage -> 1..3 retrieve stages -> 0..1 fusion stage -> 0..1 rerank stage
```

It supports distinct complete-plan candidates for external-only replacement, local-plus-external augmentation, and external reranking. The ports and evaluation executor exist, but the layer is neither a general DAG nor an operationally selectable plan.

V2 separates index preparation from query execution, binds an immutable preparation receipt, and records a privacy-bounded receipt for every stage. Query projection is outside engine adapters and cannot establish truth, effects, authority, or plan selection. A reranker may only reorder or drop its bounded registered input; it cannot introduce a source. Required-stage failure fails the complete plan closed. A reduced plan must be reviewed separately, not used as a runtime fallback.

For unmanaged direct terminal preparation, query projection is limited to registered knowledge in the current repository. An empty or failed projection has no evidentiary meaning for another repository or an external or shared service. Source expansion requires a separately available tool and authority; it is never derived from keyword, synonym, translation, or phrase routing.

The operational plan resolver reads only content-bound bundles from `.lervo/search-retrieval-plan-bundles` and immutable local transitions. It rebuilds the current repository-knowledge Markdown corpus; validates its exact reviewed path-and-content digest, document count, and byte count; resolves the registered engine build; checks the current provider projector population; executes independent queries through `SearchEnginePort`; fuses validated coordinates; and maps selected paths to current concepts. The review retains its broader repository scan ID as an evidence coordinate, but runtime corpus equivalence excludes that mutable non-corpus coordinate so workstream and activation observations cannot invalidate an unchanged Markdown corpus. The baseline remains local and requires neither a Hub nor a provider credential. Plan rollback does not mutate engine selection or delete external state.

Built-in adapters may remain in process. Third-party adapters require a future versioned out-of-process protocol and exact installation lock. Search must never dynamically resolve arbitrary modules, paths, packages, or URLs. External data export, environment targets, network, credentials, retention, and cost require separate authorization. Exact deterministic replay is the initial activation class.

## Linked-context disposition

Ordinary managed Codex and Claude runs do not project, select, load, or inject deterministic linked-only context after search. The exact linked canary remains default-off historical experiment infrastructure with no public activation input. A dependency-injected evaluation executor may reproduce the paired experiment, but default application composition does not supply it.

## Decisions

- [Lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md)
- [Recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md)
- [Engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md)
- [Operational resolution](../decisions/search/0061-fail-closed-operational-search-engine-resolution.md)
- [Adapter build identity](../decisions/search/0063-search-adapter-build-identity-and-replay-receipt.md)
- [Linked-default retirement](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
- [Replacement and composition](../decisions/search/engines/0306-separate-search-engine-replacement-and-composition.md)
- [Lexical-v2 evaluation disposition](../decisions/search/engines/0307-revise-lexical-v2-after-local-and-provider-evaluation.md)
- [Lexical-v2 v12 confirmation disposition](../decisions/search/engines/0309-retain-lexical-v1-after-lexical-v2-v12-confirmation.md)
- [Lexical-v2 v20 engineering qualification](../decisions/search/engines/0318-qualify-lexical-v2-after-v20-cross-provider-confirmation.md)
- [Reviewed real-use disposition](../decisions/search/engines/0319-keep-lexical-v2-inactive-after-reviewed-real-use-gate.md)
- [Projected-plan qualification](../decisions/search/engines/0320-qualify-projected-lexical-v2-without-engine-activation.md)
- [Retrieval-plan activation](../decisions/search/engines/0321-activate-lexical-v2-through-retrieval-plan-selection.md)
