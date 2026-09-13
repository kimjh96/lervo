import { repositoryPathWithinScope } from "@lervo/work-controller";
import type { OperatingActionPlanV1, WorkResponsibilityV1 } from "@lervo/application-contract";
import {
  assertAssignmentExecutionAuthority,
  listAgents,
  listAssignments,
  workforceLimits,
} from "@lervo/agent-workforce";
import { resolveRoleContract } from "@lervo/roles";
import { operatingContractHash } from "@lervo/work-controller";
import { NodeSupervisionError } from "./supervision-authority.js";

export async function readSupervisionAssignmentSource(input: {
  repositoryRoot: string;
  plan: OperatingActionPlanV1;
  responsibility: WorkResponsibilityV1;
  now: string;
}) {
  const { repositoryRoot, plan, responsibility: task } = input;
  const assignment = (await listAssignments(repositoryRoot)).find(
    (item) => item.assignmentId === task.assignmentId,
  );
  if (
    assignment === undefined ||
    assignment.lease === null ||
    assignment.projectId !== plan.projectId ||
    assignment.workstreamId !== plan.workstreamId ||
    assignment.revision !== task.assignmentRevision ||
    assignment.roleId !== task.roleId ||
    assignment.roleVersion !== task.roleVersion ||
    assignment.roleContractHash !== task.roleContractHash ||
    operatingContractHash(assignment.acceptanceCriteria) !==
      operatingContractHash(task.acceptanceCriteria) ||
    !["codex", "claude"].includes(plan.provider)
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  const authority = await assertAssignmentExecutionAuthority({
    repositoryRoot,
    assignmentId: task.assignmentId,
    agentId: task.executorAgentId,
    leaseId: assignment.lease.leaseId,
    provider: plan.provider as "codex" | "claude",
    expectedPaths: plan.expectedPaths,
    verificationSuiteIds: task.verificationSuiteIds,
    now: new Date(input.now),
  });
  if (operatingContractHash(authority.assignment) !== operatingContractHash(assignment))
    throw new NodeSupervisionError("supervision_readiness_changed");
  const agents = await listAgents(repositoryRoot);
  const ancestry = [authority.agent];
  while (ancestry.at(-1)!.parentAgentId !== null) {
    const child = ancestry.at(-1)!;
    const parent = agents.find((item) => item.agentId === child.parentAgentId);
    if (
      parent === undefined ||
      ancestry.some((item) => item.agentId === parent.agentId) ||
      ancestry.length > workforceLimits.maximumDelegationDepth ||
      child.delegationDepth !== parent.delegationDepth + 1
    )
      throw new NodeSupervisionError("supervision_readiness_changed");
    ancestry.push(parent);
  }
  if (
    ancestry.at(-1)!.delegationDepth !== 0 ||
    operatingContractHash(agents.find((item) => item.agentId === authority.agent.agentId)) !==
      operatingContractHash(authority.agent)
  )
    throw new NodeSupervisionError("supervision_readiness_changed");
  const roles = [];
  for (const agent of ancestry) {
    const role = await resolveRoleContract(repositoryRoot, agent.roleId);
    const capabilities: Record<string, string> = role.definition.profile.capabilities;
    if (
      agent.status !== "active" ||
      agent.projectId !== plan.projectId ||
      role.version !== agent.roleVersion ||
      role.contractHash !== agent.roleContractHash ||
      (agent.provider !== "any" && agent.provider !== plan.provider) ||
      plan.requiredCapabilities.some(
        (capability) =>
          !Object.hasOwn(capabilities, capability) || capabilities[capability] === "deny",
      ) ||
      plan.expectedPaths.some(
        (path) =>
          !agent.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
      )
    )
      throw new NodeSupervisionError("supervision_readiness_changed");
    roles.push(role);
  }
  return {
    assignment: authority.assignment,
    agent: authority.agent,
    leaseHash: operatingContractHash(authority.assignment),
    ancestryHash: operatingContractHash({ ancestry, roles }),
  };
}
