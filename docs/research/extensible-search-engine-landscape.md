# Extensible search-engine landscape

Status: `reviewed input to accepted architecture`  
As of: 2026-08-30

This companion to the [extensible search-engine architecture](extensible-search-engine-architecture.md) records the external systems and research used to select Lervo's retrieval boundary. It activates no engine, model, service, or network path.

## Systems and research findings

- [SQLite FTS5](https://www.sqlite.org/fts5.html) supplies embedded BM25, weighted columns, prefix indexes, Unicode tokenization, trigram matching, and custom tokenizers. Local `lexical-v2` can improve token and field behavior without a service. Character n-grams help identifiers, spelling, and morphology, but not semantic or cross-language mismatch.
- [Tantivy tokenizers](https://docs.rs/tantivy/latest/tantivy/tokenizer/index.html) support field-specific custom tokenizer pipelines over a local inverted index. Bind analyzer configuration and implementation identity instead of standardizing one tokenizer library; native dependencies add packaging and portability costs.
- [Qdrant hybrid and multi-stage queries](https://qdrant.tech/documentation/search/hybrid-queries/) support parallel prefetch, nested stages, rank- or distribution-based fusion, and later reranking. Retrieval, fusion, and reranking are separately observable responsibilities. Rank-based fusion helps when score scales differ.
- [OpenSearch hybrid search](https://docs.opensearch.org/latest/vector-search/ai-search/hybrid-search/index/) uses search pipelines to normalize or rank-fuse keyword and semantic subqueries. Composition must be a versioned pipeline configuration with a digest, not hidden adapter code. Score normalization requires evaluation.
- [Vespa phased ranking](https://docs.vespa.ai/en/ranking/phased-ranking.html) supports cheap first-stage retrieval, bounded second-phase ranking, global reranking, cross-hit normalization, and custom searchers. Candidate depth and per-stage work ceilings must be explicit. Rerankers cannot recover absent sources.
- [Meilisearch multiple embedders](https://www.meilisearch.com/docs/capabilities/hybrid_search/advanced/multiple_embedders) provides named embedders, lexical or semantic ratios, and federated weighting. Model, representation, and weighting identities belong in build and configuration evidence; convenience settings are not portable quality semantics.
- [Reciprocal Rank Fusion](https://research.google/pubs/reciprocal-rank-fusion-outperforms-condorcet-and-individual-rank-learning-methods/) combines rankings without comparable raw scores. RRF is a suitable first deterministic fusion candidate, but requires repository-specific paired evaluation and bounded input depths.
- [BEIR](https://arxiv.org/abs/2104.08663) found BM25 a robust heterogeneous baseline, while reranking and late interaction improved average zero-shot quality at greater computational cost. Retain the lexical rollback baseline and evaluate quality by repository task type rather than assuming neural dominance.
- [SPLADE v2](https://arxiv.org/abs/2109.10086) and [ColBERTv2](https://arxiv.org/abs/2112.01488) show different quality, latency, and storage tradeoffs for learned sparse expansion and token-level late interaction. “Semantic search” is not one capability: sparse, dense, and late-interaction methods require distinct adapter or configuration identities and cost observations.
- [BGE-M3](https://arxiv.org/abs/2402.03216) supports dense, learned sparse, and multi-vector retrieval in more than 100 languages with inputs up to 8,192 tokens. It is a plausible separately identified cross-language adapter candidate, not a lexical-v2 branch hidden in core. All three modes need Lervo-specific quality, size, and latency measurements.
- [SPLADE-v3](https://arxiv.org/abs/2403.06789) improves BEIR zero-shot results and can approach cross-encoder effectiveness. Learned sparse retrieval is an external or separately packaged retriever whose model and index coordinates must be locked; paper averages do not prove repository quality.
- [PLAID](https://arxiv.org/abs/2205.09707) accelerates ColBERT late interaction through centroid interaction and bounded candidate pruning. A late-interaction candidate may retrieve or rerank, but its index and CPU or accelerator costs remain distinct from a lexical baseline.
- [RECOMP](https://arxiv.org/abs/2310.04408) and [LongLLMLingua](https://arxiv.org/abs/2310.06839) report task-dependent context reductions through learned extractive, abstractive, or prompt compression. Compression requires separate loss, provenance, and exact-evidence gates. It must neither rewrite canonical sources nor be credited to the search engine.
- [Lost in the Middle](https://arxiv.org/abs/2307.03172) shows that long-context models can underuse evidence depending on position. More whole documents do not monotonically improve accuracy; evidence budgets and ordering need paired downstream evaluation.

## Synthesis

No system or paper proves a universal engine choice for Lervo. The evidence supports bounded retrieve, fusion, and rerank stages; content-bound model and analyzer identities; a retained lexical baseline; separate latency, storage, privacy, and quality observations; and downstream evaluation of evidence selection and compression.
