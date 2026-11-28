import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";

import { readAgentRegistryState } from "./agent-registry.js";
import { listRawAssignmentStates, TERMINAL_ASSIGNMENT_STATUSES } from "./assignment-state.js";

/** Who still holds a role: agents that are not retired, and assignments that have not ended. */
export interface RoleHolders {
  agentIds: string[];
  assignmentIds: string[];
}

/**
 * The live holders of `roleId` (ADR-0662), read from the raw records without resolving any role,
 * so it answers even while a role source is being changed. A retired agent and an ended
 * assignment keep their exact binding as history (ADR-0209) and hold nothing.
 */
export async function readRoleHolders(
  repositoryRoot: string,
  roleId: string,
): Promise<RoleHolders> {
  if ((await inspectRepositoryCoordinationHome(repositoryRoot)) === null)
    return { agentIds: [], assignmentIds: [] };
  const registry = await readAgentRegistryState(repositoryRoot, { readOnly: true });
  const assignments = await listRawAssignmentStates(repositoryRoot);
  return {
    agentIds: registry.value.agents
      .filter((agent) => agent.roleId === roleId && agent.status !== "retired")
      .map((agent) => agent.agentId)
      .sort(),
    assignmentIds: assignments
      .map((state) => state.value)
      .filter(
        (assignment) =>
          assignment.roleId === roleId && !TERMINAL_ASSIGNMENT_STATUSES.has(assignment.status),
      )
      .map((assignment) => assignment.assignmentId)
      .sort(),
  };
}
