import type { CreateAssignmentInput } from "./assignment-creation-contract.js";
import type { WorkforceAssignment } from "./types.js";
import { validConvergenceProvenance } from "./assignment-convergence-state.js";
import { validKnowledgeJobProvenance } from "./assignment-knowledge-job-state.js";
import { validWorkforceRoutineProvenance } from "./assignment-routine-state.js";
import { validWorkforceTopologyProvenance } from "./assignment-topology-state.js";
import {
  fail,
  boundedStrings,
  ASSIGNMENT_ID,
  safePath,
  WORKSTREAM_ID,
  HASH,
} from "./workforce-state-validation.js";
import { workforceLimits } from "./limits.js";
import { isConversationTaskType, maximumWrittenExpectedPaths } from "./assignment-path-bounds.js";

/** Pure creation preflight; storage and role lookup remain with the orchestrator. */
export function validateAssignmentCreation(
  input: CreateAssignmentInput,
  role: { version: string; contractHash: string },
  assignments: WorkforceAssignment[],
) {
  if (
    (input.expectedRoleVersion !== undefined && input.expectedRoleVersion !== role.version) ||
    (input.expectedRoleContractHash !== undefined &&
      input.expectedRoleContractHash !== role.contractHash)
  )
    fail("assignment_invalid", "The assignment role contract binding is stale.");
  if (!/^[a-z][a-z0-9._-]{1,99}$/u.test(input.taskType))
    fail("assignment_invalid", "The assignment task type is invalid.");
  const dependencyIds = [...new Set(input.dependencyIds ?? [])].sort();
  const expectedPaths = [...new Set(input.expectedPaths)].sort();
  const verificationSuiteIds = [...new Set(input.verificationSuiteIds)].sort();
  const approvalRequirements = [...new Set(input.approvalRequirements ?? [])].sort();
  if (
    !boundedStrings(dependencyIds, workforceLimits.maximumAssignmentDependencies, ASSIGNMENT_ID) ||
    !boundedStrings(input.acceptanceCriteria, 32) ||
    !boundedStrings(verificationSuiteIds, 32) ||
    !boundedStrings(approvalRequirements, 32) ||
    !boundedStrings(expectedPaths, maximumWrittenExpectedPaths(input.taskType)) ||
    !expectedPaths.every(safePath) ||
    input.acceptanceCriteria.length === 0 ||
    verificationSuiteIds.length === 0 ||
    (expectedPaths.length === 0 && !isConversationTaskType(input.taskType)) ||
    (input.accessMode !== undefined && !["read_only", "write"].includes(input.accessMode)) ||
    (input.accessMode === "read_only" &&
      input.knowledgeJob == null &&
      input.convergence == null &&
      !(
        input.expectedRoleVersion === role.version &&
        input.expectedRoleContractHash === role.contractHash &&
        HASH.test(input.requiredCapabilityHash ?? "")
      )) ||
    (input.knowledgeJob != null && input.accessMode !== "read_only") ||
    (input.workstreamId !== undefined && !WORKSTREAM_ID.test(input.workstreamId)) ||
    (input.requiredCapabilityHash !== undefined &&
      input.requiredCapabilityHash !== null &&
      !HASH.test(input.requiredCapabilityHash)) ||
    (input.routine !== undefined &&
      input.routine !== null &&
      !validWorkforceRoutineProvenance(input.routine)) ||
    (input.routine !== undefined && input.routine !== null && input.workstreamId === undefined) ||
    (input.topology !== undefined &&
      input.topology !== null &&
      (!validWorkforceTopologyProvenance(input.topology) || input.workstreamId === undefined)) ||
    (input.knowledgeJob !== undefined &&
      input.knowledgeJob !== null &&
      (!validKnowledgeJobProvenance(input.knowledgeJob) || input.workstreamId === undefined)) ||
    (input.convergence != null &&
      (!validConvergenceProvenance(input.convergence) || input.recordEvent === undefined)) ||
    [input.routine, input.topology, input.knowledgeJob, input.convergence].filter(
      (item) => item != null,
    ).length > 1 ||
    (input.routine !== undefined &&
      input.routine !== null &&
      input.topology !== undefined &&
      input.topology !== null) ||
    (input.initialStatus === "blocked" && (input.topology === undefined || input.topology === null))
  )
    fail(
      "assignment_invalid",
      "Assignment dependencies, criteria, verification, approval, paths, or workstream are invalid.",
    );
  if (
    dependencyIds.some(
      (dependencyId) => !assignments.some((assignment) => assignment.assignmentId === dependencyId),
    )
  )
    fail("assignment_invalid", "An assignment dependency does not exist.");
  return { dependencyIds, expectedPaths, verificationSuiteIds, approvalRequirements };
}
