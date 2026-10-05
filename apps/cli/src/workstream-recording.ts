import { randomUUID } from "node:crypto";

import type { ProjectStorage } from "@lervo/project-storage";
import {
  RepositoryKnowledgeError,
  type WorkstreamStartReceipt,
  type WorkstreamUpdateReceipt,
} from "@lervo/repository-knowledge";

import type { WorkstreamActor } from "./workstream-command-input.js";

/**
 * Persists the exact snapshot bytes in CAS and appends `workstream.snapshot.recorded`. The event
 * carries coordinates and hashes only; snapshot text stays in the artifact.
 */
export function workstreamSnapshotRecorder(input: {
  storage: ProjectStorage;
  actor: WorkstreamActor;
  operation: "start" | "update";
}) {
  const identity = randomUUID().replaceAll("-", "");
  return async (
    applied: WorkstreamStartReceipt | WorkstreamUpdateReceipt,
    snapshotContent: string,
  ): Promise<void> => {
    let artifact;
    try {
      artifact = await input.storage.artifacts.put(snapshotContent);
    } catch (error) {
      throw new RepositoryKnowledgeError(
        "knowledge_apply_failed",
        `The workstream ${input.operation} snapshot artifact could not be persisted.`,
        undefined,
        { cause: error },
      );
    }
    if (artifact.contentHash !== applied.snapshotContentHash)
      throw new RepositoryKnowledgeError(
        "knowledge_apply_failed",
        `The persisted workstream snapshot differs from the ${input.operation} binding.`,
      );
    try {
      input.storage.events.append({
        eventId: `evt_${identity}`,
        projectId: applied.projectId,
        runId: `run_${identity}`,
        sessionId: `ses_${identity}`,
        type: "workstream.snapshot.recorded",
        occurredAt: applied.appliedAt,
        actor:
          input.actor.kind === "agent"
            ? { kind: "agent", provider: input.actor.provider }
            : { kind: "user" },
        schemaVersion: 1,
        policyVersion: applied.snapshotContentHash,
        payload: {
          workstreamId: applied.workstreamId,
          revision: applied.revision,
          status: applied.status,
          changeKind: applied.operation,
          snapshotArtifactId: `art_${applied.snapshotContentHash.slice("sha256:".length)}`,
          snapshotContentHash: applied.snapshotContentHash,
          previousSnapshotContentHash: applied.previousSnapshotContentHash,
          sourceArtifactId: null,
          sourceContentHash: null,
          recordedAt: applied.appliedAt,
        },
      });
    } catch (error) {
      throw new RepositoryKnowledgeError(
        "knowledge_apply_failed",
        `The workstream ${input.operation} event could not be recorded: ${error instanceof Error ? error.message : "unknown event-store failure"}`,
        undefined,
        { cause: error },
      );
    }
  };
}
