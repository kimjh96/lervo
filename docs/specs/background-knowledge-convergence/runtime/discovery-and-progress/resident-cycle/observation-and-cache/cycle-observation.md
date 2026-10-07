# Cycle observation and reuse

## Complete baseline

`processKnowledgeConvergence` replays canonical convergence history once per event head and reuses the projection for discovery, dependency resumption, outbox reconciliation and status. Any append forces a fresh replay.

When no delivery was claimed and the event head is unchanged, closing status reuses the opening baseline. The runtime host reuses a discovered baseline for later dependency checks while the repository digest and event head remain unchanged.

Baseline discovery captures source bytes once, bracketing capture with the repository digest. It reports `source_bytes_changed` when the digest moved. `inspectRepositoryKnowledgeCurrency` accepts the already prepared knowledge scan. `snapshotHash`, `policyHash`, `debtDigest` and every event payload are computed exactly as before.

## Repository observation across event appends

[ADR-0486](../../../../../../decisions/knowledge/semantics/0486-regenerate-stale-semantic-candidates-and-reuse-repository-observation.md) refines complete-baseline reuse by splitting cycle-scoped discovery into two parts:

- Repository observation contains the scan, source capture, normalization inspection, currency inspection and candidates. It is reused while the repository fence and the latest `knowledge.materialization.applied` event are unchanged.
- Event-derived state contains historical obligations, settled dispositions and acceptance. It refreshes on every new event head.

An ordinary stage or assignment event requires fresh event-derived information without repeating repository observation. The unchanged-event-head condition governs reuse of the complete baseline, not its repository observation alone.

Materialization always invalidates repository observation because it can rewrite ignored generated state invisible to the repository fence. Repository changes also require a fresh observation.

This separation preserves source-capture fences, digest computations and cache guarantees. Reuse establishes no new verification or currency claim.
