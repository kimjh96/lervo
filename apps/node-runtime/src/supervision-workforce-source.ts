import { repositoryPathWithinScope, repositoryPathScopesOverlap } from "@lervo/work-controller";
import type { WorkResponsibilityV1 } from "@lervo/application-contract";
import { listAgents, listAssignments, workforceLimits } from "@lervo/agent-workforce";
import { resolveRoleContract } from "@lervo/roles";
import {
  assertWorkResponsibility,
  operatingContractHash,
  type WorkforceAllocationCandidate,
} from "@lervo/work-controller";

/** Observes canonical staff, ancestry and live path ownership; task readiness remains independent. */
export async function observeSupervisionWorkforce(input: {
  repositoryRoot: string;
  projectId: string;
  ownerAgentId: string;
  provider: "codex" | "claude";
  responsibility: WorkResponsibilityV1;
  /** Planning after this exact returned lease is settled; never authorizes a claim. */
  settledPredecessor?: { assignmentHash: string; leaseId: string };
  now(): string;
}) {
  const task = structuredClone(input.responsibility);
  assertWorkResponsibility(task);
  const observedAt = input.now();
  const agents = await listAgents(input.repositoryRoot);
  const assignments = await listAssignments(input.repositoryRoot);
  const predecessor = assignments.find((item) => item.assignmentId === task.assignmentId);
  if (
    input.settledPredecessor !== undefined &&
    (predecessor?.status !== "leased" ||
      predecessor.lease?.leaseId !== input.settledPredecessor.leaseId ||
      operatingContractHash(predecessor) !== input.settledPredecessor.assignmentHash ||
      task.assignmentRevision !== predecessor.revision + 2)
  )
    throw new Error("The post-settlement workforce plan differs from its exact predecessor.");
  const live = assignments.filter(
    (item) =>
      item.lease !== null &&
      Date.parse(item.lease.expiresAt) > Date.parse(observedAt) &&
      !(input.settledPredecessor !== undefined && item.assignmentId === task.assignmentId),
  );
  const roleIds = [...new Set(agents.map((agent) => agent.roleId))].sort();
  const roleResults = await Promise.allSettled(
    roleIds.map((id) => resolveRoleContract(input.repositoryRoot, id)),
  );
  const roles = new Map(roleIds.map((id, index) => [id, roleResults[index]!]));
  const candidates: WorkforceAllocationCandidate[] = agents.map((agent) => {
    const reasons = new Set<string>();
    const ancestry = [agent];
    while (ancestry.at(-1)!.parentAgentId !== null) {
      const child = ancestry.at(-1)!;
      const parent = agents.find((item) => item.agentId === child.parentAgentId);
      if (
        parent === undefined ||
        ancestry.some((item) => item.agentId === parent.agentId) ||
        ancestry.length > workforceLimits.maximumDelegationDepth ||
        child.delegationDepth !== parent.delegationDepth + 1
      ) {
        reasons.add("ancestry_invalid");
        break;
      }
      ancestry.push(parent);
    }
    if (ancestry.at(-1)!.delegationDepth !== 0) reasons.add("ancestry_invalid");
    const roleEvidence = [];
    for (const member of ancestry) {
      const observedRole = roles.get(member.roleId)!;
      if (observedRole.status === "rejected") {
        reasons.add("role_unobserved");
        continue;
      }
      const role = observedRole.value;
      roleEvidence.push({
        roleId: role.roleId,
        version: role.version,
        contractHash: role.contractHash,
      });
      if (member.projectId !== input.projectId || member.status !== "active")
        reasons.add("ancestry_inactive");
      if (role.contractHash !== member.roleContractHash || role.version !== member.roleVersion)
        reasons.add("role_binding_changed");
      if (member.provider !== "any" && member.provider !== input.provider)
        reasons.add("provider_incompatible");
      const capabilities: Record<string, string> = role.definition.profile.capabilities;
      if (
        task.requiredCapabilities.some(
          (capability) =>
            !Object.hasOwn(capabilities, capability) || capabilities[capability] === "deny",
        )
      )
        reasons.add("capability_missing");
      if (
        task.expectedPaths.some(
          (path) =>
            !member.responsibilityPaths.some((scope) => repositoryPathWithinScope(path, scope)),
        )
      )
        reasons.add("path_scope_missing");
    }
    if (
      agent.roleId !== task.roleId ||
      agent.roleVersion !== task.roleVersion ||
      agent.roleContractHash !== task.roleContractHash
    )
      reasons.add("task_role_incompatible");
    const conflicts = live.filter(
      (assignment) =>
        assignment.lease!.agentId === agent.agentId ||
        assignment.expectedPaths.some((path) =>
          task.expectedPaths.some((expected) => repositoryPathScopesOverlap(path, expected)),
        ),
    );
    const status = reasons.has("role_unobserved")
      ? ("unobserved" as const)
      : reasons.size > 0
        ? ("incompatible" as const)
        : conflicts.length > 0
          ? ("busy" as const)
          : ("available" as const);
    if (conflicts.length > 0) reasons.add("live_lease_conflict");
    return {
      agentId: agent.agentId,
      isOwner: agent.agentId === input.ownerAgentId,
      status,
      sourceHash: operatingContractHash({ ancestry, roleEvidence, conflicts }),
      reasonCodes: [...reasons].sort(),
    };
  });
  const age = Date.parse(input.now()) - Date.parse(observedAt);
  if (
    !Number.isFinite(age) ||
    age < 0 ||
    age > 5000 ||
    operatingContractHash(await listAgents(input.repositoryRoot)) !==
      operatingContractHash(agents) ||
    operatingContractHash(await listAssignments(input.repositoryRoot)) !==
      operatingContractHash(assignments)
  )
    throw new Error("The workforce observation changed while planning.");
  return {
    observedAt,
    assignmentSourceHash: operatingContractHash(assignments),
    agentSourceHash: operatingContractHash(agents),
    roleSourceHash: operatingContractHash(
      roleResults.map((result, index) =>
        result.status === "fulfilled"
          ? {
              roleId: roleIds[index],
              version: result.value.version,
              contractHash: result.value.contractHash,
            }
          : { roleId: roleIds[index], status: "unobserved" },
      ),
    ),
    sourceHash: operatingContractHash({
      projectId: input.projectId,
      task,
      agents,
      assignments,
      candidates,
      ...(input.settledPredecessor === undefined
        ? {}
        : { settledPredecessor: input.settledPredecessor }),
    }),
    candidates,
    activeWorkers: agents.filter((agent) => agent.status === "active").length,
    liveLeaseCount: live.length,
  };
}
