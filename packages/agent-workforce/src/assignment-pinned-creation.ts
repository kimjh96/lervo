import { createAssignmentOnce } from "./assignment-creation.js";
import type { CreateAssignmentInput } from "./assignment-creation-contract.js";
import { retryConcurrent } from "./workforce-state-io.js";

/** A delegated caller pins the role and capability for a normal, scoped workforce lease. */
export function createPinnedAssignment(
  input: Omit<CreateAssignmentInput, "convergence" | "knowledgeJob" | "routine" | "topology"> & {
    expectedRoleVersion: string;
    expectedRoleContractHash: string;
    requiredCapabilityHash: string;
    accessMode: "read_only" | "write";
  },
) {
  return retryConcurrent(() => createAssignmentOnce(input));
}
