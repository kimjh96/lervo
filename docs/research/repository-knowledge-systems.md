# Repository knowledge systems research

Status: `accepted input`  
As of: 2026-08-23

## Evaluation question

Lervo must continuously compile repository knowledge from code, configuration, schemas, tests, documents, verification, execution evidence, and bounded metadata—not merely organize a documentation folder. Evaluation covered source authority, stable coordinates, incremental processing, claim provenance, human and machine projections, ownership preservation, local operation, exchange, and prompt-injection resistance.

## Comparative findings

| Approach | Adopted boundary |
| --- | --- |
| [Open Knowledge Format 0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md?plain=1) | Use Markdown bundle, concept ID, progressive-index, provenance, lifecycle, trust, and exchange semantics; do not force front matter into user files. |
| [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) and [Microsoft LLMWiki](https://github.com/microsoft/llmwiki/blob/main/ARCHITECTURE.md) | Adopt continuous incremental compilation from immutable source; do not copy every source into `raw/` or treat append-only logs as current truth. |
| [Microsoft GraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | Adopt document, source-unit, entity, relation, claim, summary, and claim-provenance stages; keep model graphs and summaries rebuildable. |
| [SCIP](https://scip-code.org/) and [Tree-sitter](https://github.com/tree-sitter/tree-sitter/blob/master/lib/include/tree_sitter/api.h) | Use optional language-neutral symbol, reference, syntax-tree, and incremental-range locator adapters; do not assume precise indexing for every language. |
| [Aider repository map](https://aider.chat/docs/repomap.html), [RepoGraph](https://arxiv.org/abs/2410.14684), and [RepoAgent](https://aclanthology.org/2024.emnlp-demo.46/) | Adopt token-bounded, dependency-aware progressive context projection; do not promote task maps to canonical knowledge. |
| [W3C PROV-DM](https://www.w3.org/2012/10/prov-dm) and [OpenLineage](https://github.com/OpenLineage/OpenLineage/blob/main/spec/OpenLineage.md) | Use a small provenance vocabulary that separates entities, activities, agents, jobs, runs, inputs, and outputs and binds exact inputs to outputs. |
| [in-toto](https://github.com/in-toto/docs/blob/master/in-toto-spec.md) and [SLSA provenance](https://github.com/slsa-framework/slsa/blob/main/spec/build-provenance.md) | Bind receipts to materials, snapshot, compiler build, policy, build definition, actors, subjects, and output digests; do not require signatures for every local compile. |
| [W3C SHACL](https://www.w3.org/TR/shacl/) | Model reusable, read-only shape validation with structured severity without requiring RDF or SPARQL. |
| [Backstage TechDocs](https://backstage.io/docs/techdocs/generated-index/) | Preserve docs-like-code, repository metadata, ownership, catalog search, and Git-reviewed human entrypoints; do not require a central catalog. |
| [Diátaxis](https://diataxis.fr/), [arc42](https://github.com/arc42/arc42-template), and [C4](https://c4model.com/) | Offer reader-oriented publication profiles and progressive architecture views without forcing one ontology or directory tree. |
| [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) and [OpenAI prompt-injection guidance](https://openai.com/safety/prompt-injections/) | Treat retrieved content as untrusted, isolate source bytes as data, and compile semantics without shell, writes, network, or external actions. |

## Selected design

Lervo uses an evidence-bound repository knowledge compiler:

1. Discover the bounded repository independently of folder conventions.
2. Classify sources into stable file, section, key, symbol, revision, verification, event, and skill-contract units.
3. Produce deterministic structural navigation and optional provider-neutral semantic candidates.
4. Reconcile duplicates, contradictions, changes, and missing lineage before review.
5. Write automatically only to Lervo-generated outputs and declared managed blocks; require exact review for user-byte changes.
6. Keep Markdown, repository state, skill definitions, verification results, and execution events canonical. Keep graphs, lexical indexes, embeddings, and task maps rebuildable.

The design combines OKF exchange, the LLMWiki compiler model, optional parser-grade locators, bounded task projections, minimal provenance, content-bound receipts, read-only lint, reader-oriented publication profiles, and least-privilege compilation. It does not adopt any upstream system wholesale.

See the [repository knowledge specification](../specs/repository-knowledge-compilation.md) and [ADR-0170](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md).
