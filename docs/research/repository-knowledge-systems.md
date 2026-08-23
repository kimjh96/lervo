# Repository knowledge systems research

Status: `accepted input`
As of: 2026-08-23

## Evaluation question

Lervo needs more than a documentation-folder organizer. It must continuously compile repository knowledge from code, configuration, schemas, tests, existing documents, verification, execution evidence, and bounded metadata. Candidate approaches were evaluated for source authority, stable coordinates, incremental processing, claim provenance, human and machine projections, ownership preservation, local operation, exchange, and prompt-injection resistance.

## Comparative findings

| Approach | Useful properties | Adopted boundary |
|---|---|---|
| [Open Knowledge Format 0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md?plain=1) | Markdown bundles, hierarchical indexes, concept IDs, claim citations, lifecycle and trust | Use bundle, concept, progressive-index, provenance, and exchange semantics; do not force front matter into user files |
| [Karpathy LLM Wiki](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) and [Microsoft LLMWiki](https://github.com/microsoft/llmwiki/blob/main/ARCHITECTURE.md) | Recompile a wiki continuously from immutable source | Adopt the incremental compiler model; do not copy every source into `raw/` or treat append-only logs as current truth |
| [Microsoft GraphRAG](https://microsoft.github.io/graphrag/index/default_dataflow/) | Document, text-unit, entity, relation, claim, and summary stages | Adopt source units and claim provenance; keep model graphs and summaries rebuildable |
| [SCIP](https://scip-code.org/) and [Tree-sitter](https://github.com/tree-sitter/tree-sitter/blob/master/lib/include/tree_sitter/api.h) | Language-neutral symbols, references, syntax trees, and incremental ranges | Use optional locator adapters; never assume every language has a precise index |
| [Aider repository map](https://aider.chat/docs/repomap.html), [RepoGraph](https://arxiv.org/abs/2410.14684), and [RepoAgent](https://aclanthology.org/2024.emnlp-demo.46/) | Token-bounded task context and dependency-aware maps | Adopt progressive context projection; do not promote a task map to canonical knowledge |
| [W3C PROV-DM](https://www.w3.org/2012/10/prov-dm) and [OpenLineage](https://github.com/OpenLineage/OpenLineage/blob/main/spec/OpenLineage.md) | Separate entities, activities, agents, jobs, runs, inputs, and outputs | Use a small provenance vocabulary bound to exact inputs and outputs |
| [in-toto](https://github.com/in-toto/docs/blob/master/in-toto-spec.md) and [SLSA provenance](https://github.com/slsa-framework/slsa/blob/main/spec/build-provenance.md) | Bind materials, build definition, subjects, and actors | Bind compilation receipts to snapshot, compiler build, policy, and output digests; do not require signatures for every local compile |
| [W3C SHACL](https://www.w3.org/TR/shacl/) | Read-only shape validation with structured severity | Model reusable lint results without requiring RDF or SPARQL |
| [Backstage TechDocs](https://backstage.io/docs/techdocs/generated-index/) | Docs-like-code, repository metadata, ownership, catalog search | Keep Git-reviewed human entrypoints; do not require a central catalog |
| [Diátaxis](https://diataxis.fr/), [arc42](https://github.com/arc42/arc42-template), and [C4](https://c4model.com/) | Reader-oriented document types and progressive architecture views | Offer publication profiles without forcing one ontology or directory tree |
| [OWASP Agentic Top 10](https://genai.owasp.org/resource/owasp-top-10-for-agentic-applications-for-2026/) and [OpenAI prompt-injection guidance](https://openai.com/safety/prompt-injections/) | Treat retrieved content as untrusted and constrain capability | Isolate source bytes as data and run semantic compilation without shell, write, network, or external actions |

## Selected design

Lervo uses an evidence-bound repository knowledge compiler:

1. Discover the whole bounded repository independently of folder conventions.
2. Classify sources and split them into stable file, section, key, symbol, revision, verification, event, and skill-contract units.
3. Produce deterministic structural navigation and optional provider-neutral semantic candidates.
4. Reconcile duplicates, contradictions, changes, and missing lineage before review.
5. Automatically write only Lervo-generated outputs and declared managed blocks; require exact review for user-byte changes.
6. Keep Markdown, repository state, skill definitions, verification results, and execution events canonical. Graphs, lexical indexes, embeddings, and task maps remain rebuildable projections.

This combines OKF exchange, the LLMWiki compiler model, optional parser-grade locators, bounded task projections, minimal provenance vocabulary, content-bound receipts, read-only lint, reader-oriented publication profiles, and least-privilege compilation. No single upstream system is adopted wholesale.

See the [repository knowledge specification](../specs/repository-knowledge-compilation.md) and [ADR-0170](../decisions/knowledge/repository/0170-evidence-bound-repository-knowledge-compilation.md).
