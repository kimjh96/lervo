import type {
  WorkforceAssignment,
  WorkforceAssignmentKnowledgeJobProvenance,
  WorkforceEventRecorder,
} from "./types.js";
import { createAssignmentOnce } from "./assignment-creation.js";
import { retryConcurrent } from "./workforce-state-io.js";

export function createKnowledgeJobAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  roleVersion: string;
  roleContractHash: string;
  requiredCapabilityHash: string | null;
  priority: number;
  dependencyIds: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements: string[];
  expectedPaths: string[];
  workstreamId: string;
  knowledgeJob: WorkforceAssignmentKnowledgeJobProvenance;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() =>
    createAssignmentOnce({
      ...input,
      expectedRoleVersion: input.roleVersion,
      expectedRoleContractHash: input.roleContractHash,
    }),
  );
}
