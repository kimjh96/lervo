# ADR-0307: Revise lexical-v2 after local and provider evaluation

Status: `accepted`  
Date: 2026-08-30

## Context

ADR-0306 authorized a deterministic lexical-v2 candidate behind the existing engine port before external replacement or composition work. The candidate passed the shared replay contract and improved aggregate local ranking and warm-query latency. However, it failed the existing per-task activation-quality threshold, retained case-level ranking regressions, and took about 2.3 times longer to build its index.

The paired provider experiment tested whether the candidate also reduced answer tokens and total duration. Codex preserved pass count and recall but reduced precision slightly, increased reported tokens by 0.55%, and increased duration by 9.26%. Claude produced too many invalid result carriers for an eligible comparison and had 7.91% greater total observed duration. The complete evidence is [recorded separately](../../../evidence/search/lexical-v2/lexical-v2-local-and-provider-comparison-v1.md).

Five of eight provider cases returned identical top-three paths in both arms, while lexical-v2 supplied 0.87% more source bytes overall. Whole-engine ranking could not meet a 10% token-reduction target while the delivery policy continued to inject three whole documents.

## Decision

Reject lexical-v2 activation and all combined token, provider-duration, cross-language, and production-quality claims from this experiment. Operational retrieval remains `lexical-v1`.

Keep `lexical:2` and `lexical-v2` registered as an inert evaluation candidate with content-bound adapter build identity. Registration permits comparison only; it does not bypass comparison review, activation, runtime replay, or explicit rollback.

Preserve the final candidate behavior for further local evaluation:

- Deterministically fuse lexical-v1-compatible field ranking with Unicode word BM25F.
- Use postings to remove full-corpus query scans.
- Decompose identifiers separately from ordinary words.
- Apply trigrams only to absent Latin identifier or spelling terms; do not claim Korean morphology or translation.

Measure the next research as three independent candidates:

1. A common provider-native structured result carrier, because incomplete Claude output invalidates measurement of engine effects.
2. Section-scoped evidence delivery or loss-bounded extractive compression, because token reduction belongs to context selection rather than ranking scores.
3. A multilingual external or local semantic retriever, initially considering a content-locked BGE-M3-class adapter, because lexical character overlap cannot recover Korean-to-English semantic mismatch.

Keep the external-retriever prototype provider-free and out of process. It may initially use external-only replacement mode against a repository-owned fixture. Treat local-plus-external RRF and external reranking as later, distinct candidates. This decision authorizes no live credentials, corpus export, hosted retention, network activation, or production routing.

The next paired provider suite must use the same native JSON schema for both adapters, retain independent no-retry sessions, require complete usage, and evaluate each provider separately. It must not reuse incomplete Claude totals or aggregate incompatible provider token categories.

## Consequences

The local candidate remains available for reproducible engineering without overstating end-to-end value. The failed provider hypothesis prevents presenting a fast local microbenchmark as user-visible speed or token savings.

Token efficiency now belongs explicitly to an architectural stage above retrieval. Multilingual recall belongs explicitly to a retriever or query-projection stage. This separation adds work but keeps ranking, context bytes, provider formatting, and answer quality independently observable.

## Verification

- The lexical-v2 adapter passes the common deterministic engine contract plus input immutability, query privacy, identifier, spelling, no-false-cross-language, and invalid-limit tests.
- The checked-in local runner uses exact suite corpus roots and exclusions, alternating timing pairs, and content-bound engine builds.
- The provider suite validator fixes its cases, self-influence exclusions, protocol digest, invocation ceiling, repetitions, and acceptance gates.
- Codex and Claude arms use independent no-tool sessions and retain only bounded answer digests, paths, usage, duration, and failure codes.
- Candidate registration causes no operational selection or activation transition.

## References

- [ADR-0306](0306-separate-search-engine-replacement-and-composition.md)
- [Comparison evidence](../../../evidence/search/lexical-v2/lexical-v2-local-and-provider-comparison-v1.md)
- [Extensible search research](../../../research/extensible-search-engine-architecture.md)
