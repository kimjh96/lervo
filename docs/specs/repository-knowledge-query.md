# Repository knowledge query

Status: `active`
As of: 2026-09-16

## Scope

This specification owns concept, claim, relation, impact, lexical ranking, relevance filtering, and reviewed relation projection. The main [repository knowledge compilation specification](repository-knowledge-compilation.md) owns source discovery, compilation, and materialization.

## Canonical and projected records

Concept sidecars record title, language, type, path, ownership, lifecycle, source versions, assurance, and freshness. Bundle sidecars record language. Claims cite evidence versions. Relations include `depends_on`, `constrains`, `related_to`, `supersedes`, and `contradicts`.

User-authored Markdown and reviewed semantic sidecars are canonical. Unreviewed structural records, graph projections, and lexical indexes are rebuildable.

## Direct retrieval

Impact compares stored and current versions, marking subjects `current`, `stale`, or `unknown`. Query ranks direct concepts using title, path, and body evidence, then applies a deterministic relative relevance floor derived from the strongest current result. This prevents an isolated weak overlap from loading beside a substantially stronger task match.

The compatibility exact-term floor uses no language-specific keyword, alias, synonym, or stop-word mapping. Product composition supplies the qualified Lexical v2 implementation through a provider-neutral prepare-once/query-many ranker port. An explicit repository engine selection remains authoritative for the secondary knowledge ranking within a managed search turn. Long-running hosts may reuse a prepared index only while the exact repository source revision is unchanged; indexes are rebuildable projections rather than canonical records.

Ranked results expose the applied `{ id, version }` engine and `adapterBuildId`. The metadata contains no query text, source bytes, credential, provider identity, or personal data. Missing metadata means a compatibility caller omitted the ranker. Invalid, duplicate, unknown, non-positive, or unsafe-score results fail closed. A fuzzy engine hit may have no legacy literal `matchedTerms`; that list reports literal overlap only and does not prove why the engine ranked a result.

Query results are `recommended`; ranking and cache evidence do not prove selection, loading, injection, reference, or use.

## Reviewed relation projection

Knowledge query may derive a separate reviewed relation projection for managed context. The projection:

- Follows exactly one current, human-reviewed relation from a direct concept.
- Examines at most 64 edges.
- Returns at most five distinct targets.
- Permits at most two graph selections.

Each target path must resolve to one concept and one registered document. Its current bytes are hashed at query time and bound to the source snapshot and impact report; concept records do not claim to store a document content hash. Exact concept and relation sidecar-set hashes make the projection rebuildable. Graph coordinates remain outside search-engine scoring and index identity.
