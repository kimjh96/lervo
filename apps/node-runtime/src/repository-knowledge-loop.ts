import { startAutonomousKnowledgeWorker } from "@lervo/repository-knowledge-runtime";
import { type ProjectStorage } from "@lervo/project-storage";
import type { SQLiteEventStore } from "@lervo/event-store-sqlite";
import type { RepositoryKnowledgeWorkerHost } from "@lervo/repository-knowledge";
import {
  runRepositoryKnowledgeWorker,
  type RepositoryKnowledgeWorkerProvider,
} from "@lervo/repository-knowledge-compiler";
import type { ArtifactStore } from "@lervo/storage-contract";

import { ConversationChangeLoop } from "./conversation-change-loop.js";
import { watchLocalEventChanges } from "./local-event-wakeup.js";
import { startKnowledgeWorkerProcess } from "./knowledge-worker-process.js";
import {
  createKnowledgeConvergenceOwnership,
  instructionCandidateTransport,
  createKnowledgePublisher,
} from "./knowledge-convergence-ownership.js";

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
  storage?: ProjectStorage;
  signal?: AbortSignal;
  onFailure(error: unknown): void;
  workerEntry?: string;
}): () => Promise<void> {
  if (
    (input.storage?.writableEventSchemaVersion ?? 1) >= 4 &&
    input.host === undefined &&
    input.workerEntry !== undefined
  )
    return startKnowledgeWorkerProcess({
      entry: input.workerEntry,
      repositoryRoot: input.repositoryRoot,
      provider: input.provider,
      ...(input.executable === undefined ? {} : { executable: input.executable }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      onFailure: input.onFailure,
    });
  if ((input.storage?.writableEventSchemaVersion ?? 1) >= 4 && input.host === undefined)
    return startAutonomousKnowledgeWorker({
      storage: input.storage!,
      workerId: `node-${process.pid}`,
      provider: input.provider,
      ownership: createKnowledgeConvergenceOwnership(input.storage!, input.provider),
      instructionCandidateTransport,
      publish: createKnowledgePublisher(input.repositoryRoot),
      ...(input.executable === undefined ? {} : { executable: input.executable }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      subscribe: (notify) => watchLocalEventChanges(input.store, notify),
      onFailure: input.onFailure,
    });
  const loop = new ConversationChangeLoop({
    intervalMs: 60_000,
    continueOnFailure: true,
    failureRetryMs: () => 60_000,
    subscribe: (notify) => watchLocalEventChanges(input.store, notify),
    onFailure: input.onFailure,
    runCycle: async () => {
      return runRepositoryKnowledgeWorker({
        repositoryRoot: input.repositoryRoot,
        events: input.store,
        artifacts: input.artifacts,
        workerId: `node-${process.pid}`,
        provider: input.provider,
        ...(input.executable === undefined ? {} : { executable: input.executable }),
        ...(input.host === undefined ? {} : { host: input.host }),
      });
    },
  });
  loop.start();
  return () => loop.stop();
}
