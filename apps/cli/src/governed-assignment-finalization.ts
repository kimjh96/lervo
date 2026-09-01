import { completeAssignment, type WorkforceArtifactReference } from "@lervo/agent-workforce";
import { openProjectStorage } from "@lervo/project-storage";

import { recordWorkforceEvent } from "./workforce-events.js";

export interface FinalizeGovernedAssignmentInput {
  repositoryRoot: string;
  assignmentId: string;
  agentId: string;
  leaseId: string;
  verificationStatus: "passed" | "failed";
  resultArtifacts: WorkforceArtifactReference[];
  failureCode?: string;
  now?: Date;
}

export type FinalizeGovernedAssignment = (input: FinalizeGovernedAssignmentInput) => Promise<void>;

export const finalizeGovernedAssignment: FinalizeGovernedAssignment = async (input) => {
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    await completeAssignment({
      repositoryRoot: storage.paths.repositoryRoot,
      assignmentId: input.assignmentId,
      agentId: input.agentId,
      leaseId: input.leaseId,
      verificationStatus: input.verificationStatus,
      resultArtifacts: input.resultArtifacts,
      ...(input.failureCode === undefined ? {} : { failureCode: input.failureCode }),
      now: input.now ?? new Date(),
      recordEvent: (event) => recordWorkforceEvent(storage, event),
    });
  } finally {
    await storage.close();
  }
};
