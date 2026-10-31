import {
  startAutonomousKnowledgeWorker,
  createChangeReviewHost,
  admittedBackgroundContext,
} from "@lervo/repository-knowledge-runtime";
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
import type { KnowledgeHubCoordinates } from "./knowledge-hub-coordinates.js";
import {
  createKnowledgeConvergenceContinuity,
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
  /** ADR-0469: this Node's Hub coordinates for zero-touch owner-host configuration. */
  hub?: KnowledgeHubCoordinates;
  /**
   * ADR-0470: start the resident child although the writer is older than schema 4; the child
   * holds with `event_schema_outdated` and resumes after activation.
   */
  awaitAdmission?: boolean;
}): () => Promise<void> {
  if (
    ((input.storage?.writableEventSchemaVersion ?? 1) >= 4 || input.awaitAdmission === true) &&
    input.host === undefined &&
    input.workerEntry !== undefined
  )
    return startKnowledgeWorkerProcess({
      entry: input.workerEntry,
      repositoryRoot: input.repositoryRoot,
      provider: input.provider,
      ...(input.hub === undefined ? {} : { hub: input.hub }),
      ...(input.signal === undefined ? {} : { signal: input.signal }),
      onFailure: input.onFailure,
    });
  if ((input.storage?.writableEventSchemaVersion ?? 1) >= 4 && input.host === undefined)
    return startAutonomousKnowledgeWorker({
      storage: input.storage!,
      workerId: `node-${process.pid}`,
      provider: input.provider,
      ownership: createKnowledgeConvergenceOwnership(input.storage!, input.provider),
      continuity: createKnowledgeConvergenceContinuity(input.storage!, input.hub ?? null),
      instructionCandidateTransport,
      publish: createKnowledgePublisher(input.repositoryRoot),
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
      if (input.host === undefined && input.storage === undefined)
        throw Object.assign(
          new Error("Background knowledge needs project storage and a delegation."),
          { code: "knowledge_authority_unavailable" },
        );
      const selected =
        input.host === undefined
          ? await admittedBackgroundContext({ storage: input.storage!, provider: input.provider })
          : null;
      return runRepositoryKnowledgeWorker({
        repositoryRoot: input.repositoryRoot,
        events: input.store,
        artifacts: input.artifacts,
        workerId: `node-${process.pid}`,
        provider: input.provider,
        host:
          input.host ??
          createChangeReviewHost({
            ...selected!,
            signal: input.signal ?? new AbortController().signal,
            liveWorkPending: async () => false,
          }),
      });
    },
  });
  loop.start();
  return () => loop.stop();
}
