import {
  changeAgentStatus,
  pruneRetiredLervoAgents,
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
/**
 * Convergence hiring names each worker by role and delegation; a path suffix splits scopes.
 * Practice learning hires the same roles under a separate prefix.
 */
const CONVERGENCE_AGENT_NAME =
  /^(?:Knowledge|Practice) (generator|reviewer|writer|integrator) ([0-9a-f]{12})(?: (?:[0-9a-f]{6}|[0-9a-f]{8}))?$/u;

/** The display name of the worker that serves one role under one reviewed delegation. */
export function convergenceAgentName(role: ConvergenceWorkerRole, delegationHash: string): string {
  return `Knowledge ${role} ${delegationHash.slice(7, 19)}`;
}

/** The practice-learning worker for one role and delegation, within the 40-character name bound. */
export function practiceAgentName(role: ConvergenceWorkerRole, delegationHash: string): string {
  return `Practice ${role} ${delegationHash.slice(7, 19)}`;
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

/** The name of the root agent that seeding hires to steward knowledge continuity. */
const STEWARD_NAME = "Knowledge Steward";

/**
 * Agents that are Lervo's own, which maintain repository knowledge, rather than the project's team
 * (Lervo ADE agents, "Team agents and Lervo's agents"): the convergence delegation's parent and
 * everyone under it, the steward and everyone under it, and any agent named as a convergence or
 * practice worker. Retired agents count too, so a list of any statuses classifies consistently.
 */
export function lervoAgentIds(
  agents: readonly WorkforceAgent[],
  delegation: ConvergenceDelegation | null,
): Set<string> {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  const roots = new Set(
    agents
      .filter(
        (agent) =>
          agent.agentId === delegation?.parentAgentId ||
          agent.displayName === STEWARD_NAME ||
          CONVERGENCE_AGENT_NAME.test(agent.displayName),
      )
      .map((agent) => agent.agentId),
  );
  const isLervos = (agent: WorkforceAgent): boolean => {
    // Parent chains are acyclic and at most the registry's size long; the bound keeps a corrupt
    // chain from looping.
    let current: WorkforceAgent | undefined = agent;
    for (let step = 0; current !== undefined && step <= agents.length; step += 1) {
      if (roots.has(current.agentId)) return true;
      current = current.parentAgentId === null ? undefined : byId.get(current.parentAgentId);
    }
    return false;
  };
  return new Set(agents.filter(isLervos).map((agent) => agent.agentId));
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
  // ADR-0643: each renewal retires a set, so keep only the latest retired ones.
  if (retired.length > 0) await pruneRetiredLervoAgents({ repositoryRoot: input.repositoryRoot });
  return retired;
}
