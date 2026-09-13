import type { AssignmentTopologyAssignmentObservationV2 } from "@lervo/application-contract";
import { assignmentTopologyDigest } from "@lervo/work-controller";
import type { WorkforceAssignment } from "./types.js";

export function topologyAssignmentObservation(
  assignment: WorkforceAssignment,
): AssignmentTopologyAssignmentObservationV2 {
  return {
    assignmentId: assignment.assignmentId,
    revision: assignment.revision,
    status: assignment.status,
    workstreamId: assignment.workstreamId,
    taskType: assignment.taskType,
    roleId: assignment.roleId,
    roleVersion: assignment.roleVersion,
    roleContractHash: assignment.roleContractHash,
    requiredCapabilityHash: assignment.requiredCapabilityHash ?? null,
    priority: assignment.priority,
    dependencyIds: [...assignment.dependencyIds].sort(),
    acceptanceDigest: assignmentTopologyDigest(assignment.acceptanceCriteria),
    verificationDigest: assignmentTopologyDigest([...assignment.verificationSuiteIds].sort()),
    approvalDigest: assignmentTopologyDigest([...assignment.approvalRequirements].sort()),
    expectedPathDigest: assignmentTopologyDigest([...assignment.expectedPaths].sort()),
    topology: assignment.topology ?? null,
  };
}
