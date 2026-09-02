import type { GovernedCompletionReconciliationCommandV1 } from "@lervo/application-contract";
import { reconcileAssignmentCompletion } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";

export type ReconcileGovernedAssignment = (input: {
  repositoryRoot: string;
  command: GovernedCompletionReconciliationCommandV1;
  now?: Date;
}) => Promise<void>;

export const reconcileGovernedAssignment: ReconcileGovernedAssignment = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (storage.manifest.projectId !== input.command.projectId) {
      throw new Error("The completion reconciliation project changed before apply.");
    }
    await reconcileAssignmentCompletion({
      repositoryRoot: storage.paths.repositoryRoot,
      assignmentId: input.command.assignmentId,
      assignmentRevision: input.command.assignmentRevision,
      agentId: input.command.agentId,
      leaseId: input.command.leaseId,
      resultArtifact: {
        artifactId: input.command.resultArtifactId,
        contentHash: input.command.resultContentHash,
      },
      completionEvidenceId: input.command.completionEvidenceId,
      reconciliationCommandId: input.command.commandId,
      sourceRunId: input.command.runId,
      preparedAt: input.command.preparedAt,
      now: input.now ?? new Date(),
      recordEvent: (event) => recordWorkforceEvent(storage, event),
    });
  } finally {
    await storage.close();
  }
};
