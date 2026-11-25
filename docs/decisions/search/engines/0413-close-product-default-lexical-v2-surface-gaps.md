# ADR-0413: Close product-default Lexical v2 surface gaps

Status: `accepted`  
Amended by: [ADR-0459](../../execution/orchestration/improvement/0459-measure-context-hits-and-usage-on-every-channel.md), [ADR-0497](../../operations/storage/0497-reuse-exact-event-page-verification.md), [ADR-0498](../../knowledge/maintenance/0498-prepare-fresh-knowledge-reads-in-order.md), [ADR-0499](../../knowledge/maintenance/0499-reuse-content-bound-knowledge-preparation-projections.md)
Date: 2026-09-16

## Context

ADR-0328 made qualified Lexical v2 the product default, but application composition applied it inconsistently. Discord conversation retrieval and direct-terminal selection supplied the default; managed local runs and supervision planning omitted it, resolving the compatibility Lexical v1 baseline. `lervo knowledge query` and secondary repository-knowledge ranking in managed context used a separate hand-written exact-term ranker. The CLI retained a test-only duplicate of managed search composition.

Identical product terminology therefore hid surface-dependent behavior. Direct queries also rebuilt repository knowledge unless callers used the revision-aware Node wrapper. Canonical knowledge remained intact, but typo tolerance, ranking evidence, and cold-scan cost varied across Discord, Codex, Claude, supervision, and the CLI.

## Decision

All shipped CLI and Node composition paths supply the qualified product default when no explicit repository selection exists. An explicit local baseline or reviewed candidate remains authoritative for operational managed search. The same resolved operational engine ranks secondary repository-knowledge candidates for that managed turn, carrying the same mutually exclusive `selectionTransitionId` or `productQualificationId` evidence.

Repository knowledge defines a provider-neutral `RepositoryKnowledgeQueryRanker` port with separate `prepare` and `rank` operations. The repository-context composition package adapts the qualified Lexical v2 index to this port. Repository knowledge stays independent of concrete search adapters; callers intentionally omitting the ranker retain the compatibility exact-term implementation. Product CLI queries, terminal fallback projections, supervision planning, and revision-aware Node queries install the Lexical v2 adapter. The duplicate CLI composition module is removed.

Preparation occurs once per knowledge index and supports many queries. The long-running Node wrapper shares one pending preparation and reuses the prepared index only for the exact repository source revision. Revision changes invalidate the projection. A one-shot CLI invocation prepares once for its process. No cache result proves a recommendation was selected, loaded, injected, referenced, or used.

`KnowledgeQueryResult.ranking` identifies the applied engine as `{ id, version }` and records `adapterBuildId`. These fields contain no query text, source bytes, credential, provider identity, or personal data. Their absence means a compatibility caller did not install a ranker; it does not establish that Lexical v1 was observed. Unknown concepts, duplicate concepts, non-positive scores, unsafe scores, changed adapter builds, and selected-adapter failures fail closed. Product composition does not silently retry with Lexical v1.

Lexical v2 may return fuzzy results with an empty legacy exact `matchedTerms` list. `matchedTerms` describes only literal terms observed in title, path, or body; it is not ranking proof. The engine coordinate and ordered scores provide ranking evidence.

## Performance disposition

The existing v20 engineering gate remains the qualification evidence. It reported no local case regressions, warm-query ratios of `0.944` and `0.870` against the comparison baseline, and lower provider token, duration, and byte totals for both reviewed provider suites.

A 2026-09-16 current-repository check measured five alternating preparations over 2,879 supplemental source candidates and 1,000 prepared queries per engine:

| Measurement | Lexical v1 | Lexical v2 |
| --- | --- | --- |
| Average preparation | `1,841.49 ms` | `1,865.23 ms` |
| Average prepared query | `0.52 ms` | `3.38 ms` |
| Prepared-query p95 | `0.72 ms` | `6.19 ms` |

Lexical v2 is slower on this direct knowledge-query microbenchmark, but remains single-digit milliseconds and does not materially change the dominant cold preparation cost. The misspelled query `lexcal retrievel engin` returned no v1 results and five relevant v2 search-design sources. Long-running hosts therefore require revision-bound reuse. Unbounded timers, stale-revision reuse, and per-query index rebuilding are unacceptable optimizations.

## Consequences

Product-default behavior matches the published decision across current surfaces while preserving explicit repository selection and local rollback. Discord and a future first-party conversation surface share repository-context composition rather than transport-specific ranking. Search indexes remain rebuildable projections over canonical Markdown and reviewed sidecars.

Library consumers and tests retain the compatibility exact-term path. Product code must install an explicit ranker and expose its coordinate. Future rankers must use the same port and qualification boundary rather than surface-specific code.

## Verification

- Assert product-default engine and qualification evidence in managed local and supervision planning.
- Assert CLI and revision-aware knowledge results expose Lexical v2 engine and adapter-build coordinates.
- Assert explicit Lexical v1 selection ranks both operational and secondary knowledge candidates with v1.
- Assert fuzzy retrieval improves the current typo case without changing canonical sources.
- Run repository-context, CLI, supervision, type, quality, documentation, build, and release-completion checks.

## References

- [Product-default Lexical v2](0328-make-qualified-lexical-v2-the-product-default.md)
- [Search and context boundaries](../../../architecture/search-and-context.md)
- [Repository knowledge query](../../../specs/repository-knowledge-query.md)
- [V20 qualification evidence](../../../evidence/search/lexical-v2/lexical-v2-activation-confirmation-v20.md)
