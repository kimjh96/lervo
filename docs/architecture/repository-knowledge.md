# Repository knowledge and document ownership

Status: `active`
As of: 2026-08-30

## Knowledge pipeline

A bounded scanner discovers sources without assuming folder structure. Adapters extract stable file, section, key, symbol, revision, verification, event, and skill-contract units. A deterministic structural compiler builds a bounded knowledge map and sidecars. Isolated, capability-free Codex or Claude compilers may produce source-cited semantic or normalization candidates.

Human documentation remains under `docs/`, including `docs/knowledge`; `.lervo` contains policy, provenance, manifests, and rebuildable state. `.lervo/knowledge/document-layout.yaml` routes decisions, documents, and canonical instructions through explicit metadata or recorded semantic classification, never title keywords; an unclassified document defers to the background resident instead of blocking, and Markdown that its own workspace package consumes is never moved. Provider-neutral behavior belongs in `docs/instructions/<route>`, portable Agent Skills in `.agents/skills`, and machine registries use deterministic two-hex fan-out while retaining legacy flat-path reads. `foundation` is never an implicit fallback.

Normalization produces bounded English Markdown for an audience profile with complete source-section coverage. Every source requires exact approval. Content-bound shard caches and a three-process ceiling keep runs bounded and resumable without weakening compiler-build or source binding. Planning revalidates inner bindings and the complete current source set. Lifecycle sidecars bind output hashes, format and language versions, compiler build, and skill-resource hashes. Changed documents or skills become stale without automatic rewriting.

Markdown and repository state are canonical; graphs, lexical indexes, and embeddings are rebuildable. Generated indexes use a reduced structural snapshot that excludes runtime evidence, revision metadata, verification results, and local-only agent surfaces. Full query snapshots may differ without implying staleness; currency is determined by the current migration plan and manifest. Tracked policy selects language (`en` in v1), entry bounds, and byte bounds. Large categories become short page trees; obsolete recorded pages are safely deleted.

## Document ownership

Each document has one write model:

- `user`: register and read bytes; never rewrite automatically.
- `managed_blocks`: replace only an exact marked block after content-bound approval.
- `lervo_generated`: refresh only when prior generation proves ownership.

README is a byte-preserved, normalization-independent public entrypoint by default. An optional improvement is a separate audience-and-intent-bound proposal with individual protected-coordinate dispositions. AGENTS is the provider-neutral agent entrypoint with a fixed-size managed bootstrap. Canonical instruction and skill routing is resolved from repository knowledge by task purpose and target paths, so adding a source does not edit AGENTS. CLAUDE imports AGENTS through a managed bridge while retaining its user region. Provider settings remain provider-specific; migration adds only approved Lervo hooks and preserves all other semantics.

## Decisions

- [Knowledge compilation](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md)
- [OKF exchange](../decisions/knowledge/repository/0171-content-addressed-okf-exchange-and-git-reproduction.md)
- [Agent surface inventory](../decisions/knowledge/repository/0189-typed-repository-agent-surface-inventory.md)
- [Bounded publication](../decisions/knowledge/repository/0190-language-aware-bounded-repository-publication.md)
- [Decision taxonomy](../decisions/knowledge/repository/0192-repository-scoped-decision-taxonomy.md)
- [Semantic document routing](../decisions/knowledge/documents/0476-route-legacy-documents-semantically-and-never-migrate-application-content.md)
- [Document normalization](../decisions/knowledge/repository/0195-reviewed-document-content-normalization.md)
- [Sharded documents](../decisions/knowledge/documents/0017-sharded-document-manifests.md)
- [Existing document adoption](../decisions/knowledge/documents/0018-existing-document-adoption.md)
- [CommonMark blocks](../decisions/knowledge/documents/0021-commonmark-managed-block-parser.md)
- [Instruction bridges](../decisions/knowledge/repository/0185-profiled-provider-instruction-bridge.md)
