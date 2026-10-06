# Runtime ownership

`@lervo/repository-knowledge` owns provider-neutral baseline replay, stage handoff, receipts, and settlement. The bundled private `@lervo/repository-knowledge-runtime` composes repository sources, workforce, managed workspaces, integration, normalization, and lifecycle verification. CLI and Node share this runtime; provider process behavior remains in `@lervo/repository-knowledge-compiler`.

Under [ADR-0441](../../../../decisions/knowledge/repository/canonicalization/0441-isolate-resident-knowledge-from-node-conversations.md), the standalone Node hosts the version-four resident owner in one owned child of the same immutable runtime artifact. Under [ADR-0442](../../../../decisions/knowledge/repository/canonicalization/0442-isolate-conversation-repository-snapshots.md), managed conversation repository snapshots use a separate one-shot child of that artifact, retaining the existing snapshot policy and deadline.

[ADR-0444](../../../../decisions/knowledge/repository/canonicalization/0444-serialize-knowledge-materialization-with-managed-runs.md) requires:

- Managed provider runs hold a shared repository source lease from admission through settlement.
- Durable knowledge apply and recovery hold an exclusive lease around the complete journal and event effect.
- Concurrent turns may read together; knowledge writers use bounded retry scheduling while a turn is active.
- Busy or invalid managed admission fails the existing repository snapshot stage before provider start.
- An interrupted materialization journal blocks new managed reads until recovery.

[ADR-0483](../../../../decisions/operations/services/0483-wait-for-live-knowledge-materialization-in-foreground-commands.md) separates a live materialization owner from an interrupted one for foreground commands:

- `lervo upgrade`, `lervo knowledge` subcommands other than `worker` and `convergence`, `lervo migrate knowledge`, `lervo state`, `lervo terminal status`, and `lervo terminal declare` wait while another running process owns the marker. They poll every 2 seconds, with at most 15 minutes for the whole command, and print one stderr notice per owner.
- Terminal hooks and attention inspection wait at most 10 seconds because provider hooks have a 30-second timeout.
- An expired wait fails with `knowledge_materialization_wait_expired`, names the owner process, plan, and phase, and leaves the marker unchanged.
- An interrupted marker still fails immediately with `knowledge_recovery_required` and names `lervo knowledge materialize --recover`.

The resident knowledge child awaits ordinary cleanup on parent shutdown. A snapshot child stops read-only capture if its parent disappears. This grants no new provider or write authority. Library hosts without a runtime entry retain existing behavior. Installed child ancestry and real busy Discord acceptance require observation independent of source tests.

When an active knowledge materialization transaction causes the knowledge index to return `knowledge_recovery_required`, a managed conversation read records and uses only its operational repository search attempt. That turn emits no knowledge attempt, knowledge recommendation, relation projection, or currency claim. Other knowledge-source failures still fail closed. This fallback neither settles nor recovers the background transaction; the owner retains that obligation.
