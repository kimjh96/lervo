# Repository knowledge query

Status: `active`
As of: 2026-10-05

## Scope

This specification owns concepts, claims, relations, impact, lexical ranking, relevance filtering, and reviewed relation projection. The [repository knowledge compilation specification](repository-knowledge-compilation.md) owns source discovery, compilation, and materialization.

## Canonical and projected records

Concept sidecars record title, language, type, path, ownership, lifecycle, source versions, assurance, and freshness. Bundle sidecars record language. Claims cite evidence versions. Relations include `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`.

User-authored Markdown and reviewed semantic sidecars are canonical. Unreviewed structural records, graph projections, and lexical indexes are rebuildable projections.

## Direct retrieval

Impact compares stored and current versions, marking subjects `current`, `stale`, or `unknown`. Query ranks direct concepts using title, path, and body evidence, then applies a deterministic relative relevance floor derived from the strongest current result. The floor prevents isolated weak overlap from loading alongside a substantially stronger task match.

The compatibility exact-term floor uses no language-specific keyword, alias, synonym, or stop-word mapping. Product composition supplies the qualified Lexical v2 implementation through a provider-neutral prepare-once/query-many ranker port. Explicit repository engine selection remains authoritative for secondary knowledge ranking within a managed search turn. Long-running hosts may reuse a prepared index only while the exact repository source revision is unchanged. Indexes are rebuildable, not canonical.

Interactive repository-context preparation, CLI knowledge query, and product search admit the newest 4,096 privacy-valid execution events plus the independently bounded verification corpus. They validate the complete event chain before projecting that window. Older events remain canonical in the event store and available to full lifecycle compilation. Execution-history growth alone must not make interactive queries exceed the repository file-count budget.

Interactive preparation shares one verified event traversal between execution and verification sources, captured through the same latest sequence. Combined sources become available only after verification artifacts pass. The SQLite adapter can reuse connection-local validation receipts only after rereading and hashing every raw page and matching its incoming chain hash. This removes repeated computation without reducing history coverage or repository scanning; see [ADR-0497](../decisions/operations/storage/0497-reuse-exact-event-page-verification.md).

Repository preparation compiles exclusion patterns once per scan attempt and overlaps fresh concept-sidecar and publication reads. Every eligible input is processed, results retain registry order, and all existing publication safety and freshness checks remain in force. Read scheduling imposes no new corpus or result limit; see [ADR-0498](../decisions/knowledge/maintenance/0498-prepare-fresh-knowledge-reads-in-order.md).

Query preparation may reuse exact-content-bound source-unit extraction, validated concept decoding, and adapter-owned field analysis across processes. Each preparation still reads current canonical bytes and rebuilds global ranking statistics from the current corpus. Only changed computational inputs are reprocessed; incompatible or corrupt projections fall back to full computation. These projections are optional local state and never write authority. `preparationCache: "disabled"` selects the full reference path; see [ADR-0499](../decisions/knowledge/maintenance/0499-reuse-content-bound-knowledge-preparation-projections.md).

Cache envelope schema 2 avoids whole-cache JSON strings, and lexical field reuse shares read-only frequency maps with the index. Old JSON or incompatible binary projections trigger full reconstruction. This changes only the rebuildable representation, preserving source coverage, freshness, scoring, and evidence contracts; see [ADR-0500](../decisions/knowledge/maintenance/0500-avoid-duplicate-knowledge-cache-representations.md).

Ranked results expose the applied `{ id, version }` engine and `adapterBuildId`. This metadata contains no query text, source bytes, credential, provider identity, or personal data. Missing metadata means a compatibility caller omitted the ranker. Invalid, duplicate, unknown, non-positive, or unsafe-score results fail closed. A fuzzy engine hit may have no legacy literal `matchedTerms`; that list reports literal overlap only and does not explain the engine's ranking.

Historical documents, as defined in [ADR-0464](../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md), are excluded from default results on both compatibility and ranker paths. The ranker receives a `historical` label and is asked for extra candidates so the result limit still holds. A query naming history as a whole word (`archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, or `deprecated`) includes those documents; each historical hit carries `historical: true`.

Query results are `recommended`. Ranking and cache evidence do not prove selection, loading, injection, reference, or use.

## Reviewed relations (retired)

Knowledge query derives no relation projection, and managed context selects no document from reviewed relations. [ADR-0523](../decisions/search/activation/0523-retire-reviewed-relation-context.md) retired the one-hop projection because it never received a reviewed relation and a comparable linked mechanism showed no quality benefit. Stored `context.selected` events with the `graph_recommendation` reason remain valid; no current path emits that reason. A future relation-based mechanism must enter through the search-engine port and paired comparison under ADR-0302.

## Partial scan coverage

[ADR-0537](../decisions/knowledge/repository/source-intake/0537-degrade-over-budget-scans-by-priority.md) keeps queries available when eligible sources exceed `maxTotalBytes`. JSON results include `coverage: "complete" | "partial"` and `skippedForBudget: { count, bytes, classes }`. Text output reports the same coverage, skipped source count and bytes, and distinct skipped classes on one line. Hits from admitted publications remain recommendations; a partial result never proves repository-wide absence. The publication loader does not reread budget-skipped sources. Prompt and review context accept this subset; operations certifying currency require complete coverage.

Impact reports and refresh candidates preserve scan coverage and skipped counts, bytes, and classes. An evidence unit absent from a partial scan is `unknown` with reason `scan_incomplete`, so it cannot imply deletion or suggest deprecation. A partial report never has overall `current` status. Observed units may still prove their own evidence current or changed. A partial refresh candidate remains `review_required` even when its observed items need no change. These fields add no event or source content; existing relative-path and private-artifact handling applies.
