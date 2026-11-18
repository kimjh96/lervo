# Repository-knowledge ranking

Repository-knowledge ranking uses a separate provider-neutral prepare-once/query-many port because the knowledge compiler cannot depend on a concrete search adapter.

Product CLI, managed local execution, supervision planning, direct-terminal fallback, and long-running conversation composition install the qualified Lexical v2 adapter. Managed secondary knowledge ranking uses the same product-default engine as its operational search.

Long-running hosts cache the prepared projection only for the exact repository source revision and share concurrent preparation. Source-revision changes invalidate the cache. Results expose engine and adapter-build coordinates.

Compatibility callers that deliberately omit the port retain the legacy exact-term ranker. See ADR-0413.
