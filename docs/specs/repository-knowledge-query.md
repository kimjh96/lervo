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

Ranked results expose the applied `{ id, version }` engine and `adapterBuildId`. This metadata contains no query text, source bytes, credential, provider identity, or personal data. Missing metadata means a compatibility caller omitted the ranker. Invalid, duplicate, unknown, non-positive, or unsafe-score results fail closed. A fuzzy engine hit may have no legacy literal `matchedTerms`; that list reports literal overlap only and does not explain the engine's ranking.

Historical documents, as defined in [ADR-0464](../decisions/knowledge/documents/0464-report-document-drift-and-historical-documents.md), are excluded from default results on both compatibility and ranker paths. The ranker receives a `historical` label and is asked for extra candidates so the result limit still holds. A query naming history as a whole word (`archive`, `archived`, `historical`, `history`, `legacy`, `superseded`, `obsolete`, or `deprecated`) includes those documents; each historical hit carries `historical: true`.

Query results are `recommended`. Ranking and cache evidence do not prove selection, loading, injection, reference, or use.

## Reviewed relation projection

Knowledge query may derive a separate reviewed relation projection for managed context. The projection:

- Follows exactly one current, human-reviewed relation from a direct concept.
- Examines at most 64 edges.
- Returns at most five distinct targets.
- Permits at most two graph selections.

Each target path must resolve to one concept and one registered document. Current document bytes are hashed at query time and bound to the source snapshot and impact report; concept records do not claim to store a document content hash. Exact concept and relation sidecar-set hashes make the projection rebuildable. Graph coordinates remain outside search-engine scoring and index identity.
