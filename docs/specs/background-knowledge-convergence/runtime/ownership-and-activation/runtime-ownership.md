# Runtime ownership

`@lervo/repository-knowledge` owns provider-neutral baseline replay, stage handoff, receipts, and settlement. The bundled private `@lervo/repository-knowledge-runtime` composes repository sources, workforce, managed workspaces, integration, normalization, and lifecycle verification. CLI and Node share this runtime; provider process behavior remains in `@lervo/repository-knowledge-compiler`.

Under [ADR-0441](../../../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md), the standalone Node hosts the version-four resident owner in one owned child of the same immutable runtime artifact. Under [ADR-0442](../../../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md), managed conversation repository snapshots use a separate one-shot child of that artifact, retaining the existing snapshot policy and deadline.

The resident knowledge child awaits ordinary cleanup on parent shutdown. A snapshot child stops read-only capture if its parent disappears. This grants no new provider or write authority. Library hosts without a runtime entry retain existing behavior. Installed child ancestry and real busy Discord acceptance require observation independent of source tests.

- [Managed runs and materialization](runtime-ownership/managed-runs-and-materialization.md)
- [Upgrade exclusion and foreground waits](runtime-ownership/upgrade-and-foreground-waits.md)
