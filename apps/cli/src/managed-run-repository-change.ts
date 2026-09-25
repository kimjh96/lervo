import type { ManagedFileChangeEvidence } from "@lervo/execution-contract";
import type { ProjectStorage } from "@lervo/project-storage";
import { appendRepositoryChange, planRepositoryChange } from "@lervo/repository-knowledge";

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
    afterRevision: string;
    managedChanges: readonly ManagedFileChangeEvidence[];
  };
  eventId: string;
  occurredAt: string;
}): Promise<{ eventId: string; enqueued: boolean } | null> {
  if (input.storage.writableEventSchemaVersion !== 3) return null;
  const files = (side: "beforeHash" | "afterHash") =>
    Object.fromEntries(
      input.completion.managedChanges.flatMap((change) =>
        change[side] === null ? [] : [[change.path, change[side]!]],
      ),
    );
  const planned = planRepositoryChange({
    sourceKind: "managed_run",
    sourceEventId: input.completion.terminalEventId,
    before: { revision: input.completion.beforeRevision, files: files("beforeHash") },
    after: { revision: input.completion.afterRevision, files: files("afterHash") },
    occurredAt: input.occurredAt,
  });
  if (planned === null) return null;
  const stored = await input.storage.artifacts.put(planned.manifestContent);
  if (stored.contentHash !== planned.payload.sourceManifest.contentHash)
    throw new Error("The repository change manifest differs from its stored artifact.");
  return input.storage.events.transact((transaction) =>
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
}
