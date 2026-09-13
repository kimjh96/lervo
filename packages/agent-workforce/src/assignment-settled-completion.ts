import { completeAssignmentOnce } from "./assignment-completion.js";
import type { reconcileAssignmentCompletion } from "./assignment-completion.js";
import { retryConcurrent } from "./workforce-state-io.js";

/** The trusted owner adapter must bind the terminal time to verified canonical run evidence. */
export function reconcileSettledAssignmentCompletion(
  input: Parameters<typeof reconcileAssignmentCompletion>[0] & { executionCompletedAt: string },
) {
  return retryConcurrent(() =>
    completeAssignmentOnce({
      repositoryRoot: input.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.leaseId,
      resultArtifacts: [input.resultArtifact],
      verificationStatus: "passed",
      ...(input.now === undefined ? {} : { now: input.now }),
      ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
      reconciliation: {
        completionEvidenceId: input.completionEvidenceId,
        reconciliationCommandId: input.reconciliationCommandId,
        sourceRunId: input.sourceRunId,
        assignmentRevision: input.assignmentRevision,
        preparedAt: input.preparedAt,
        executionCompletedAt: input.executionCompletedAt,
      },
    }),
  );
}
