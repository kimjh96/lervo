# Terminal preparation and snapshot delegation

## Retrieval preparation

In retrieval mode, `apps/cli/src/terminal-prompt-preparation.ts` computes the prompt digest and concurrently starts corpus preparation, query preparation, and repository snapshot capture through `Promise.all`. Durations use separate `corpus_preparation`, `query_projection`, and `repository_snapshot` stages. Overlapping durations must not be summed as elapsed time.

Corpus preparation collects supplemental local sources, then concurrently scans configured knowledge and lists canonicalization candidates. Candidate-list rejection becomes `coverage: unavailable` with an empty candidate list; it does not establish that no candidates exist. A successful list has complete coverage. Instruction-catalog inspection receives the collected sources and prepared scan. This coordinator does not convert other rejected operations to unavailable coverage.

Query preparation opens project storage, concurrently loads publication policy and the verified current workstream, and constructs either workstream projection context or an explicit no-context requirement. The query service receives the request and digest, context and digest, anchors, publication language, and selected provider. Storage closes in `finally`.

After all three branches resolve, the coordinator requires the corpus project ID and publication language to match the query branch's project ID and requested language. A mismatch throws. This comparison does not independently prove that every repository byte remained unchanged throughout preparation.

## Snapshot delegation

`apps/cli/src/terminal-repository-snapshot.ts` delegates to `capturePersistentRepositorySnapshot` from `@lervo/orchestrator`, passing the repository root and resolved cache path `.lervo/state/cache/terminal-repository-snapshot.json`. Retrieval preparation and terminal repository-change planning use this wrapper.

The wrapper adds no local validation, catch, or alternate capture path. Its comment describes stat-identity hash reuse, but the imported implementation is required to establish cache validation, invalidation, filesystem safety, and behavior after cache corruption. This call site proves neither that every capture avoids rehashing nor a measured latency improvement.

See [prompt assembly](prompt-assembly.md) for compact-mode delegation and [terminal repository changes](../repository-change-adapter-boundaries/terminal-turns.md) for before/after revision and manifest-binding checks. These source boundaries establish neither installed hook activation nor successful background knowledge review.
