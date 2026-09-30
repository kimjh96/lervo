# Product search

`product_search.inspect` (v9), exposed by `application search --corpus repository_knowledge --json <query>`, adds the first `ProductUnifiedSearchResultV1` corpus adapter.

The read-only route composes the existing repository-knowledge lifecycle and qualified Lexical v2 ranker and checks that the repository revision remains unchanged across the query. It returns:

- Query and authorization digests.
- Exact engine and adapter-build coordinates.
- A completed stage receipt.
- Stable knowledge coordinates and content hashes.

The product result excludes query text, source bodies, paths, native scores, and relation bodies.

Only `repository_knowledge` is installed in v9. Other typed corpus classes remain unavailable until their owning conversation, artifact, canvas, deliberation, approval, verification, work-event, or code adapter can prove current authorization and source validation.

This is an additive federated-search boundary, not a claim that one universal index exists.
