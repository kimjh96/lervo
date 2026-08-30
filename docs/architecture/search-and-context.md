# Search and context boundaries

Status: `active`
As of: 2026-08-30

## Evidence boundary

Search recommends but does not prove use. Selection records why an item was chosen; loading validates current bytes; delivery creates an adapter receipt before `injected` evidence exists. Later reference or use requires separate provider telemetry.

`selected`, `loaded`, `injected`, and `used` remain distinct states. An engine result can support selection but cannot claim delivery, reference, correctness, or provider use.

## Engine boundary

Operational retrieval uses `SearchEnginePort` and `SearchIndexPort`. `lexical-v1` is the local baseline. Engine adapters own indexing and ranking only. Corpus acquisition, query grounding, context selection, provider delivery, credentials, and network authority remain outside the port.

A future `lexical-v2`, another local engine, or an external adapter follows one path:

1. Implement the provider-neutral port with a distinct engine identity and content-bound adapter build identity.
2. Register the candidate in the bounded registry. Registration has no runtime effect.
3. Compare the candidate with `lexical-v1` on the same corpus and cases.
4. Review quality, latency, privacy, and cost evidence.
5. Activate through an immutable policy-bound transition.
6. Revalidate the adapter build, corpus, comparison, review, index, and response for every operational resolution.
7. Roll back explicitly to `lexical-v1` when the reviewed transition requires it.

A selected adapter failure is fail-closed. Runtime does not silently mix engines or fall back. Explicit rollback restores the local baseline without a Hub, external credential, or network service.

External engines belong in adapter packages. Core search, context, and provider orchestration do not import vendor SDKs or depend on Codex or Claude behavior. Credentials and network capability require separate authorization, and secret bytes remain runtime-only.

A reranker, query-expansion stage, remote corpus, or context-expansion mechanism needs its own measurable and observable boundary. It cannot be hidden inside an engine adapter to bypass comparison and review.

## Linked-context disposition

Ordinary managed Codex and Claude runs do not project, select, load, or inject deterministic linked-only context after search. The exact linked canary remains default-off historical experiment infrastructure with no public activation input. A dependency-injected evaluation executor may reproduce the paired experiment, but default application composition does not supply it.

## Decisions

- [Lexical search](../decisions/search/0053-deterministic-lexical-search-observations.md)
- [Recommendation boundary](../decisions/search/0054-search-recommendation-managed-context-boundary.md)
- [Engine selection](../decisions/search/0060-policy-bound-search-engine-selection.md)
- [Operational resolution](../decisions/search/0061-fail-closed-operational-search-engine-resolution.md)
- [Adapter build identity](../decisions/search/0063-search-adapter-build-identity-and-replay-receipt.md)
- [Linked-default retirement](../decisions/search/activation/provider-shadow-structured/typed-context/0302-retire-linked-default-and-use-search-engine-ports.md)
