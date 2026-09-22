import { randomUUID } from "node:crypto";

import type { RepositoryWorkProvider } from "@lervo/adapter-contract";
import { openProjectStorage } from "@lervo/project-storage";
import {
  applyWorkstreamUpdatePlan,
  createWorkstreamUpdatePlan,
  readCurrentWorkstreamState,
} from "@lervo/repository-knowledge/workstream";

import type { ConversationRepositoryWorkCompletionBaseline } from "./conversation-repository-work-completion.js";
import type { RepositoryWorkChange } from "./repository-work-observation.js";

/**
 * Recovers the bookkeeping edge after a successful provider turn. The provider still checkpoints
 * early for crash safety; this host-owned step prevents a completed, observed effect from being
 * reported as a generic failure solely because the provider CLI could not invoke Lervo.
 */
export async function reconcileConversationRepositoryWorkCheckpoint(input: {
  repositoryRoot: string;
  provider: RepositoryWorkProvider;
  baseline: ConversationRepositoryWorkCompletionBaseline;
  repositoryChange: RepositoryWorkChange;
  completedAt: string;
}): Promise<"not_needed" | "provider_checkpoint" | "host_checkpoint"> {
  if (input.repositoryChange.changedPaths.length === 0) return "not_needed";
  const current = await readCurrentWorkstreamState(input.repositoryRoot);
  if (
    current === null ||
    input.baseline.workstreamId === null ||
    input.baseline.workstreamRevision === null ||
    current.snapshot.workstreamId !== input.baseline.workstreamId
  ) {
    return "not_needed";
  }
  if (current.snapshot.revision > input.baseline.workstreamRevision) {
    return "provider_checkpoint";
  }
  if (current.snapshot.status === "completed" || current.snapshot.status === "cancelled") {
    return "not_needed";
  }

  const note =
    "Host recovery checkpoint recorded after managed conversation work changed " +
    `${input.repositoryChange.changedPaths.length} paths; completion gates remain pending.`;
  const snapshot = {
    ...current.snapshot,
    revision: current.snapshot.revision + 1,
    notes: [...current.snapshot.notes.slice(-31), note],
    updatedAt: input.completedAt,
  };
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const plan = await createWorkstreamUpdatePlan({
      repositoryRoot: input.repositoryRoot,
      projectId: storage.manifest.projectId,
      snapshot,
    });
    if (plan.status !== "ready") return "not_needed";
    const identity = randomUUID().replaceAll("-", "");
    await applyWorkstreamUpdatePlan({
      plan,
      now: new Date(input.completedAt),
      actor: "agent",
      recordApplied: async (applied, snapshotContent) => {
        const artifact = await storage.artifacts.put(snapshotContent);
        if (artifact.contentHash !== applied.snapshotContentHash) {
          throw new Error("The recovered workstream snapshot differs from its update binding.");
        }
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: applied.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "workstream.snapshot.recorded",
          occurredAt: applied.appliedAt,
          actor: { kind: "agent", provider: input.provider },
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
      },
    });
    return "host_checkpoint";
  } finally {
    await storage.close();
  }
}
