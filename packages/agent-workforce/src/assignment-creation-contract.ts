import type {
  WorkforceAssignmentRoutineProvenance,
  WorkforceAssignmentTopologyProvenance,
  WorkforceAssignmentKnowledgeJobProvenance,
  WorkforceAssignmentConvergenceProvenance,
  WorkforceEventRecorder,
  AssignmentAccessMode,
} from "./types.js";

export interface CreateAssignmentInput {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  priority?: number;
  dependencyIds?: string[];
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  approvalRequirements?: string[];
  expectedPaths: string[];
  accessMode?: AssignmentAccessMode;
  workstreamId?: string;
  requiredCapabilityHash?: string | null;
  routine?: WorkforceAssignmentRoutineProvenance | null;
  topology?: WorkforceAssignmentTopologyProvenance | null;
  knowledgeJob?: WorkforceAssignmentKnowledgeJobProvenance | null;
  convergence?: WorkforceAssignmentConvergenceProvenance | null;
  initialStatus?: "queued" | "blocked";
  expectedRoleVersion?: string;
  expectedRoleContractHash?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}
