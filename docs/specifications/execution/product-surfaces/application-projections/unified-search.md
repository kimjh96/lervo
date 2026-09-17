# `ProductUnifiedSearchResultV1`

Required top-level fields:

- `schemaVersion: 1` and `kind: product_surface.search`;
- query digest, authorization digest, requested corpus classes, and bounded result limit;
- repository revision, exact search-plan coordinate, stage receipts, and result digest;
- ordered groups by corpus class;
- terminal status plus typed failure or incompleteness reason.

Every hit requires corpus class, stable source coordinate, current source revision or content hash, privacy class, bounded title or label, ordered rank, adapter and build coordinates, and match-evidence kind.

Search results contain no authority token and cannot introduce sources outside the authorized corpora. A required adapter failure fails the selected plan. Partial results are allowed only when an explicit reviewed plan defines an optional stage and reports it as omitted.

Durable telemetry excludes raw query text, source bodies, message bodies, credentials, provider output, and native vendor scores. The authorized caller may receive bounded display excerpts through the owning source-inspection route after current source validation.

## First installed corpus

Product-host protocol v9 exposes `lervo application search --corpus repository_knowledge [--limit <1..100>] [--root <path>] --json <query>`. The command reuses the qualified product-default Lexical v2 ranker behind `RepositoryKnowledgeQueryRanker`; the product projection package does not import the concrete adapter or repository scanner.

The command captures the repository revision before and after the knowledge query and fails closed if it changes. The projector accepts only an observed engine and adapter build, at most the requested hit limit, unique concept coordinates, and current content hashes. It emits one required completed stage and classifies source privacy conservatively as `restricted`, because the knowledge hit contract does not itself prove a less restrictive class.

The returned label supports bounded presentation, but paths, raw query text, source and relation bodies, exact match terms, and ranker scores are excluded. Conversation, code, artifact, canvas, deliberation, approval, verification, and work-event corpora remain explicitly uninstalled in this protocol version.
