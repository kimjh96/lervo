# Terminal preparation and snapshot delegation

In retrieval mode, `apps/cli/src/terminal-prompt-preparation.ts` computes the prompt digest and starts corpus preparation, query preparation, and repository snapshot capture concurrently through `Promise.all`. Their durations use separate `corpus_preparation`, `query_projection`, and `repository_snapshot` stages; overlapping durations must not be summed as elapsed time.

Corpus preparation first collects supplemental local sources. It then scans configured knowledge and lists canonicalization candidates concurrently. Candidate-list rejection becomes `coverage: unavailable` with an empty candidate list; this does not establish that no candidates exist. A successful list has complete coverage. Instruction-catalog inspection receives the collected sources and prepared scan. Other rejected operations are not converted to unavailable coverage by this coordinator.

Query preparation opens project storage, loads publication policy and the verified current workstream concurrently, and constructs either workstream projection context or an explicit no-context requirement. The query service receives the request and digest, context and digest, anchors, publication language, and selected provider. Storage closes in `finally`.

After all three branches resolve, the coordinator requires the corpus project ID and publication language to match the query branch's project ID and requested language. A mismatch throws. This comparison does not independently prove that every repository byte remained unchanged throughout preparation.

`apps/cli/src/terminal-repository-snapshot.ts` delegates to `capturePersistentRepositorySnapshot` from `@lervo/orchestrator`, passing the repository root and the resolved cache path `.lervo/state/cache/terminal-repository-snapshot.json`. Retrieval preparation and terminal repository-change planning use this wrapper.

The wrapper introduces no local validation, catch, or alternate capture path. Its comment describes stat-identity hash reuse, but the imported implementation is required to establish cache validation, invalidation, filesystem safety, and behavior after cache corruption. This call site alone proves neither that every capture avoids rehashing nor a measured latency improvement.

See [prompt assembly](prompt-assembly.md) for compact-mode delegation and [terminal repository changes](../repository-change-adapter-boundaries/terminal-turns.md) for the before/after revision and manifest-binding checks. These source boundaries do not establish installed hook activation or successful background knowledge review.
