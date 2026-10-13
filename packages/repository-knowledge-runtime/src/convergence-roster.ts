import {
  changeAgentStatus,
  listAgents,
  listAssignments,
  type WorkforceAgent,
  type WorkforceEventRecorder,
} from "@lervo/agent-workforce";

import type { ConvergenceDelegation, ConvergenceWorkerRole } from "./delegation-contract.js";

const CONVERGENCE_ROLES: readonly ConvergenceWorkerRole[] = [
  "generator",
  "reviewer",
  "writer",
  "integrator",
];
/** Convergence hiring names each worker by role and delegation; a path suffix splits scopes. */
const CONVERGENCE_AGENT_NAME =
  /^Knowledge (generator|reviewer|writer|integrator) ([0-9a-f]{12})(?: [0-9a-f]{8})?$/u;

/** The display name of the worker that serves one role under one reviewed delegation. */
export function convergenceAgentName(role: ConvergenceWorkerRole, delegationHash: string): string {
  return `Knowledge ${role} ${delegationHash.slice(7, 19)}`;
}

/**
 * The delegation-hash prefix an agent serves, when convergence hired it under this delegation's
 * parent for one of the delegation's roles, or null for any other agent.
 */
function servedDelegationPrefix(
  agent: WorkforceAgent,
  delegation: ConvergenceDelegation,
): string | null {
  const match = CONVERGENCE_AGENT_NAME.exec(agent.displayName);
  if (match === null || agent.parentAgentId !== delegation.parentAgentId) return null;
  const role = match[1] as ConvergenceWorkerRole;
  if (!CONVERGENCE_ROLES.includes(role) || agent.roleId !== delegation.roles[role].roleId)
    return null;
  return match[2]!;
}

/**
 * Active agents that work under the repository's convergence delegation rather than as staff the
 * delegation's parent hired. The delegation bounds them by its own fixed roles.
 */
export function convergenceDelegationAgentIds(
  agents: readonly WorkforceAgent[],
  delegation: ConvergenceDelegation,
): Set<string> {
  return new Set(
    agents
      .filter(
        (agent) => agent.status === "active" && servedDelegationPrefix(agent, delegation) !== null,
      )
      .map((agent) => agent.agentId),
  );
}

/**
 * Retires convergence workers of superseded delegations. Every delegation renewal hires a fresh
 * set, so without this the parent's roster grows by up to four agents per renewal. A worker that
 * still holds a lease or an unfinished assignment is kept until a later call.
 */
export async function retireSupersededConvergenceAgents(input: {
  repositoryRoot: string;
  delegation: ConvergenceDelegation;
  delegationHash: string;
  recordEvent: WorkforceEventRecorder;
}): Promise<string[]> {
  const current = input.delegationHash.slice(7, 19);
  const superseded = (await listAgents(input.repositoryRoot)).filter((agent) => {
    if (agent.status !== "active") return false;
    const served = servedDelegationPrefix(agent, input.delegation);
    return served !== null && served !== current;
  });
  if (superseded.length === 0) return [];
  const busy = new Set(
    (await listAssignments(input.repositoryRoot))
      .filter(
        (assignment) =>
          assignment.assigneeAgentId !== null &&
          (assignment.lease !== null ||
            ["queued", "leased", "blocked"].includes(assignment.status)),
      )
      .map((assignment) => assignment.assigneeAgentId!),
  );
  const retired: string[] = [];
  for (const agent of superseded) {
    if (busy.has(agent.agentId)) continue;
    await changeAgentStatus({
      repositoryRoot: input.repositoryRoot,
      agentId: agent.agentId,
      expectedRevision: agent.revision,
      status: "retired",
      actorAgentId: input.delegation.parentAgentId,
      recordEvent: input.recordEvent,
    });
    retired.push(agent.agentId);
  }
  return retired;
}
