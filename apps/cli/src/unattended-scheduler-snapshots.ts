import type { WorkforceAgent, WorkforceAssignment } from "@lervo/agent-workforce";
import type {
  UnattendedSchedulerAgentV1,
  UnattendedSchedulerAssignmentV1,
} from "@lervo/application-contract";

export function unattendedSchedulerAgent(agent: WorkforceAgent): UnattendedSchedulerAgentV1 {
  return {
    agentId: agent.agentId,
    roleId: agent.roleId,
    roleVersion: agent.roleVersion,
    roleContractHash: agent.roleContractHash,
    provider: agent.provider,
    capabilityHash: agent.capabilityHash,
    skillIds: [...agent.skillIds],
    capabilityIds: (agent.capabilityPackages ?? []).map((item) => item.capabilityId).sort(),
    responsibilityPaths: [...agent.responsibilityPaths],
    status: agent.status,
  };
}

export function unattendedSchedulerAssignment(
  assignment: WorkforceAssignment,
): UnattendedSchedulerAssignmentV1 {
  return {
    assignmentId: assignment.assignmentId,
    revision: assignment.revision,
    workstreamId: assignment.workstreamId,
    taskType: assignment.taskType,
    roleId: assignment.roleId,
    roleVersion: assignment.roleVersion,
    roleContractHash: assignment.roleContractHash,
    requiredCapabilityHash: assignment.requiredCapabilityHash ?? null,
    acceptanceCriteria: [...assignment.acceptanceCriteria],
    verificationSuiteIds: [...assignment.verificationSuiteIds],
    expectedPaths: [...assignment.expectedPaths],
    assigneeAgentId: assignment.assigneeAgentId,
    lease:
      assignment.lease === null
        ? null
        : {
            leaseId: assignment.lease.leaseId,
            sessionId: assignment.lease.sessionId,
          },
  };
}
