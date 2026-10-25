import type { ManagedFileChangeEvidence } from "@lervo/execution-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import {
  appendRepositoryChange,
  planRepositoryChangeInRepository,
} from "@lervo/repository-knowledge";

import { launchDetachedKnowledgeWorker } from "./knowledge-worker-launch.js";

/**
 * Records the durable background-knowledge source for a completed managed run (ADR-0433). A
 * supervised run is recorded only after its workspace integrates, and a writer without v3 events
 * keeps the previous behavior.
 */
export async function recordManagedRunRepositoryChange(input: {
  storage: ProjectStorage;
  runId: string;
  sessionId: string;
  policyVersion: string;
  completion: {
    terminalEventId: string;
    beforeRevision: string;
    beforeCommits?: Readonly<Record<string, string>>;
    afterRevision: string;
    managedChanges: readonly ManagedFileChangeEvidence[];
  };
  eventId: string;
  occurredAt: string;
  /** The provider for the detached knowledge worker; omitted, no worker is launched. */
  provider?: "claude" | "codex";
}): Promise<{ eventId: string; enqueued: boolean } | null> {
  if ((input.storage.writableEventSchemaVersion ?? 1) < 3) return null;
  const files = (side: "beforeHash" | "afterHash") =>
    Object.fromEntries(
      input.completion.managedChanges.flatMap((change) =>
        change[side] === null ? [] : [[change.path, change[side]!]],
      ),
    );
  const planned = await planRepositoryChangeInRepository({
    repositoryRoot: input.storage.paths.repositoryRoot,
    projectId: input.storage.manifest.projectId,
    sourceKind: "managed_run",
    sourceEventId: input.completion.terminalEventId,
    before: {
      revision: input.completion.beforeRevision,
      files: files("beforeHash"),
      ...(input.completion.beforeCommits === undefined
        ? {}
        : { commits: input.completion.beforeCommits }),
    },
    after: { revision: input.completion.afterRevision, files: files("afterHash") },
    occurredAt: input.occurredAt,
  });
  if (planned === null) return null;
  const stored = await input.storage.artifacts.put(planned.manifestContent);
  if (stored.contentHash !== planned.payload.sourceManifest.contentHash)
    throw new Error("The repository change manifest differs from its stored artifact.");
  const recorded = input.storage.events.transact((transaction) =>
    appendRepositoryChange(
      transaction,
      {
        eventId: input.eventId,
        projectId: input.storage.manifest.projectId,
        runId: input.runId,
        sessionId: input.sessionId,
        occurredAt: input.occurredAt,
        actor: { kind: "system" },
        policyVersion: input.policyVersion,
      },
      planned,
    ),
  );
  // Only the installed CLI entry launches a worker; tests and embedded callers never spawn one.
  const entry = process.env.LERVO_CLI_ENTRY;
  if (recorded.enqueued && input.provider !== undefined && entry !== undefined)
    await launchDetachedKnowledgeWorker({
      root: input.storage.paths.repositoryRoot,
      entry,
      args: ["knowledge", "worker", "--once", "--provider", input.provider],
    });
  return recorded;
}
