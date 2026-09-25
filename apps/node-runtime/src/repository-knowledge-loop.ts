import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { RepositoryKnowledgeWorkerHost } from "@lervo/repository-knowledge";
import {
  runRepositoryKnowledgeWorker,
  type RepositoryKnowledgeWorkerProvider,
} from "@lervo/repository-knowledge-compiler";
import type { ArtifactStore } from "@lervo/storage-contract";

import { ConversationChangeLoop } from "./conversation-change-loop.js";
import { watchLocalEventChanges } from "./local-event-wakeup.js";

/**
 * The Node host of the core repository knowledge owner (ADR-0433). It shares the CLI worker's
 * repository lock and per-job lease, so a detached CLI worker and this loop never overlap.
 */
export function startRepositoryKnowledgeLoop(input: {
  repositoryRoot: string;
  store: SQLiteEventStore;
  artifacts: ArtifactStore;
  provider: RepositoryKnowledgeWorkerProvider;
  executable?: string;
  host?: RepositoryKnowledgeWorkerHost;
  onFailure(error: unknown): void;
}): () => Promise<void> {
  const loop = new ConversationChangeLoop({
    intervalMs: 60_000,
    continueOnFailure: true,
    failureRetryMs: () => 60_000,
    subscribe: (notify) => watchLocalEventChanges(input.store, notify),
    onFailure: input.onFailure,
    runCycle: () =>
      runRepositoryKnowledgeWorker({
        repositoryRoot: input.repositoryRoot,
        events: input.store,
        artifacts: input.artifacts,
        workerId: `node-${process.pid}`,
        provider: input.provider,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(input.host === undefined ? {} : { host: input.host }),
      }),
  });
  loop.start();
  return () => loop.stop();
}
