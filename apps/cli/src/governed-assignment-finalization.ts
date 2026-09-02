import {
  completeAssignment,
  listAssignments,
  type WorkforceArtifactReference,
} from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";
import { recordGovernedCompletionEvidence } from "./governed-completion-evidence.js";

export interface FinalizeGovernedAssignmentInput {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  verificationStatus: "passed" | "failed";
  resultArtifacts: WorkforceArtifactReference[];
  failureCode?: string;
  completionEvidence?: {
    workstreamId: string;
    assignmentRevision: number;
    runId: string;
    sessionId: string;
    writingPublicationStatus: "allowed";
  };
  now?: Date;
}

export type FinalizeGovernedAssignment = (input: FinalizeGovernedAssignmentInput) => Promise<void>;

export const finalizeGovernedAssignment: FinalizeGovernedAssignment = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const now = input.now ?? new Date();
    if (input.verificationStatus === "passed") {
      if (input.completionEvidence === undefined || input.resultArtifacts.length !== 1) {
        throw new Error("Accepted governed finalization requires exact completion evidence.");
      }
      const assignment = (await listAssignments(storage.paths.repositoryRoot)).find(
        (candidate) => candidate.assignmentId === input.assignmentId,
      );
      if (
        assignment === undefined ||
        assignment.revision !== input.completionEvidence.assignmentRevision ||
        assignment.status !== "leased" ||
        assignment.assigneeAgentId !== input.agentId ||
        assignment.lease?.leaseId !== input.leaseId ||
        assignment.lease.agentId !== input.agentId ||
        now.getTime() < Date.parse(assignment.lease.acquiredAt) ||
        now.getTime() >= Date.parse(assignment.lease.expiresAt)
      ) {
        throw new Error(
          "The governed completion evidence differs from the active assignment lease.",
        );
      }
      recordGovernedCompletionEvidence({
        storage,
        workstreamId: input.completionEvidence.workstreamId,
        assignmentId: input.assignmentId,
        assignmentRevision: input.completionEvidence.assignmentRevision,
        agentId: input.agentId,
        leaseId: input.leaseId,
        runId: input.completionEvidence.runId,
        sessionId: input.completionEvidence.sessionId,
        resultArtifactId: input.resultArtifacts[0]!.artifactId,
        resultContentHash: input.resultArtifacts[0]!.contentHash,
        preparedAt: now.toISOString(),
      });
    }
    await completeAssignment({
      repositoryRoot: storage.paths.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.leaseId,
      verificationStatus: input.verificationStatus,
      resultArtifacts: input.resultArtifacts,
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      now,
      recordEvent: (event) => recordWorkforceEvent(storage, event),
    });
  } finally {
    await storage.close();
  }
};
