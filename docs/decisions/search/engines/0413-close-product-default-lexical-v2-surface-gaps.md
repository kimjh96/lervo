# ADR-0413: Close product-default Lexical v2 surface gaps

Status: `accepted`  
Date: 2026-09-16

## Context

ADR-0328 made the qualified Lexical v2 engine the product default, but application composition did not consistently apply that decision. Discord conversation retrieval and direct-terminal selection supplied the product default. Managed local runs and supervision planning omitted it and therefore resolved the compatibility Lexical v1 baseline. `lervo knowledge query` and the secondary repository-knowledge ranking inside managed context used a separate hand-written exact-term ranker. The CLI also retained a test-only duplicate of managed search composition.

The result was surface-dependent behavior hidden behind identical product terminology. It also rebuilt repository knowledge for every direct query unless the caller happened to use the revision-aware Node wrapper. This did not corrupt canonical knowledge, but it made typo tolerance, ranking evidence, and cold-scan cost inconsistent across Discord, Codex, Claude, supervision, and the CLI.

## Decision

All shipped CLI and Node composition paths supply the qualified product default when no explicit repository selection exists. An explicit local baseline or reviewed candidate remains authoritative for operational managed search. The same resolved operational engine ranks the secondary repository-knowledge candidates used by that managed turn; it carries the same mutually exclusive `selectionTransitionId` or `productQualificationId` evidence.

Repository knowledge defines a provider-neutral `RepositoryKnowledgeQueryRanker` port with separate `prepare` and `rank` operations. The repository-context composition package adapts the qualified Lexical v2 index to that port. Repository knowledge remains independent of a concrete search adapter, and callers that intentionally omit the ranker retain the compatibility exact-term implementation. Product CLI queries, terminal fallback projections, supervision planning, and revision-aware Node queries install the Lexical v2 adapter. The duplicate CLI composition module is removed.

Preparation occurs once per knowledge index and supports many queries. The long-running Node wrapper shares one pending preparation and reuses the prepared index only for the exact repository source revision. A revision change invalidates the projection. A one-shot CLI invocation prepares once for that process. No cache result proves that a recommendation was selected, loaded, injected, referenced, or used.

`KnowledgeQueryResult.ranking` identifies the applied engine as `{ id, version }` and records `adapterBuildId`. These fields contain no query text, source bytes, credential, provider identity, or personal data. Their absence means a compatibility caller did not install a ranker, not that Lexical v1 was observed. Unknown concepts, duplicate concepts, non-positive scores, unsafe scores, changed adapter builds, and selected-adapter failures fail closed; product composition does not silently retry with Lexical v1.

Lexical v2 may return a fuzzy result whose legacy exact `matchedTerms` list is empty. `matchedTerms` continues to describe only literal terms observed in title, path, or body and is not ranking proof. The engine coordinate and ordered scores are the ranking evidence.

## Performance disposition

The existing v20 engineering gate remains the qualification evidence: it reported no local case regressions, warm-query ratios of `0.944` and `0.870` against the comparison baseline, and lower provider token, duration, and byte totals for both reviewed provider suites.

An additional 2026-09-16 current-repository check measured five alternating preparations over 2,879 supplemental source candidates and 1,000 prepared queries per engine. Lexical v1 preparation averaged `1,841.49 ms` and Lexical v2 averaged `1,865.23 ms`. Prepared Lexical v1 queries averaged `0.52 ms` with `0.72 ms` p95; Lexical v2 averaged `3.38 ms` with `6.19 ms` p95. The v2 query is slower on this direct knowledge-query microbenchmark but remains single-digit milliseconds and does not materially change the dominant cold preparation cost. The misspelled query `lexcal retrievel engin` returned no v1 results and five relevant v2 search-design sources. Revision-bound reuse is therefore required for long-running hosts; unbounded timers, stale-revision reuse, and per-query index rebuilding are not acceptable optimizations.

## Consequences

Product-default behavior now matches the published decision across current surfaces, while explicit repository selection and local rollback remain intact. Discord and a future first-party conversation surface share the same repository-context composition rather than transport-specific ranking. Search indexes remain rebuildable projections over canonical Markdown and reviewed sidecars.

The compatibility exact-term path stays available to library consumers and tests, but product code must install an explicit ranker and expose its coordinate. Future rankers must enter through the same port and qualification boundary rather than through surface-specific code.

## Verification

- Assert product-default engine and qualification evidence in managed local and supervision planning.
- Assert CLI and revision-aware knowledge results expose Lexical v2 engine and adapter-build coordinates.
- Assert explicit Lexical v1 selection still ranks both operational and secondary knowledge candidates with v1.
- Assert fuzzy retrieval improves the current typo case without changing canonical sources.
- Run repository-context, CLI, supervision, type, quality, documentation, build, and release-completion checks.

## References

- [Product-default Lexical v2](0328-make-qualified-lexical-v2-the-product-default.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)
- [Repository knowledge query](../../../specs/repository-knowledge-query.md)
- [V20 qualification evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md)
