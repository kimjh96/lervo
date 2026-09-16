# V2 search composition and resolution

## Composition contract

ADR-0306 permits this bounded v2 composition layer above the compatibility ports:

```text
0..1 query-projection stage -> 1..3 retrieve stages -> 0..1 fusion stage -> 0..1 rerank stage
```

It supports distinct complete-plan candidates for external-only replacement, local-plus-external augmentation, and external reranking. The ports and evaluation executor exist, but the layer is neither a general DAG nor an operationally selectable plan.

V2 separates index preparation from query execution, binds an immutable preparation receipt, and records a privacy-bounded receipt for every stage. Query projection remains outside engine adapters and cannot establish truth, effects, authority, or plan selection. A reranker may only reorder or drop its bounded registered input; it cannot introduce a source. Required-stage failure fails the complete plan closed. A reduced plan requires separate review and must not serve as a runtime fallback.

## Terminal projection

For unmanaged direct terminal preparation, query projection is limited to registered knowledge in the current repository. An empty or failed projection has no evidentiary meaning for another repository or an external or shared service. Source expansion requires a separately available tool and authority; keyword, synonym, translation, or phrase routing never establishes it.

Production terminal projection opens one capability-free provider runner and performs one query-producing model turn, without the historical synthetic admission turn. The provider-neutral projection port, digest and query bounds, isolated Codex thread, serialized Claude process, usage receipt, and owner-close contract remain unchanged. Provider lifecycle details remain outside search core.

## Operational resolution

The operational plan resolver first checks an explicit local selection. Without one, it resolves the shipped product qualification, rebuilds the current repository-knowledge Markdown corpus, verifies registered engine and projector builds, executes independent queries through `SearchEnginePort`, fuses validated coordinates, and maps selected paths to current concepts.

A different local candidate still reads a content-bound bundle from `.lervo/search-retrieval-plan-bundles`, verifies immutable transitions, and requires its exact reviewed corpus. A legacy activation of the exact product-default plan no longer pins the current corpus to that historical review. Both v2 and the v1 rollback baseline remain local and require neither a Hub nor a provider credential.

## Repository-knowledge ranking

Repository-knowledge ranking uses a separate provider-neutral prepare-once/query-many port because the knowledge compiler cannot depend on a concrete search adapter. Product CLI, managed local execution, supervision planning, direct-terminal fallback, and long-running conversation composition install the qualified Lexical v2 adapter. Managed secondary knowledge ranking follows the same explicit or product-default engine selection as its operational search.

Long-running hosts cache the prepared projection only for the exact repository source revision and share concurrent preparation; source-revision changes invalidate it. Results expose engine and adapter-build coordinates. Compatibility callers that deliberately omit the port retain the legacy exact-term ranker. See ADR-0413.

## Adapter execution and authorization

Built-in adapters may remain in process. Third-party adapters require a future versioned out-of-process protocol and exact installation lock. Search must never dynamically resolve arbitrary modules, paths, packages, or URLs.

External data export, environment targets, network, credentials, retention, and cost require separate authorization. Exact deterministic replay is the initial activation class.
