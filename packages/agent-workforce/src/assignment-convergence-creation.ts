import { createAssignmentOnce } from "./assignment-creation.js";
import { retryConcurrent } from "./workforce-state-io.js";
import type {
  WorkforceAssignment,
  WorkforceAssignmentConvergenceProvenance,
  WorkforceEventRecorder,
} from "./types.js";

/** V4 baseline provenance permits either isolated inspection or a separately governed write lease. */
export function createConvergenceAssignment(input: {
  repositoryRoot: string;
  taskType: string;
  roleId: string;
  expectedRoleVersion: string;
  expectedRoleContractHash: string;
  requiredCapabilityHash: string;
  convergence: WorkforceAssignmentConvergenceProvenance;
  accessMode: "read_only" | "write";
  acceptanceCriteria: string[];
  verificationSuiteIds: string[];
  expectedPaths: string[];
  priority?: number;
  now?: Date;
  recordEvent: WorkforceEventRecorder;
}): Promise<WorkforceAssignment> {
  return retryConcurrent(() => createAssignmentOnce(input));
}
