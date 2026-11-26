import { listAgents, recordAgentOrigins, type AgentOrigin } from "@lervo/agent-workforce";
import { inspectRepositoryCoordinationHome } from "@lervo/project-storage";
import { lervoAgentIds, loadConvergenceDelegation } from "@lervo/repository-knowledge-runtime";

/**
 * The upgrade stage that records each agent's origin once (ADR-0643): the origins of agents whose
 * records lack one, decided by the rule readers apply until then.
 */
export async function pendingAgentOrigins(root: string): Promise<Map<string, AgentOrigin>> {
  // A repository without a coordination home has no agents, as the role-binding stage finds.
  if ((await inspectRepositoryCoordinationHome(root)) === null) return new Map();
  const agents = await listAgents(root, { readOnly: true });
  const missing = agents.filter((agent) => agent.origin === undefined);
  if (missing.length === 0) return new Map();
  const delegation = (await loadConvergenceDelegation(root).catch(() => null))?.delegation ?? null;
  const lervos = lervoAgentIds(agents, delegation);
  return new Map(
    missing.map((agent) => [agent.agentId, lervos.has(agent.agentId) ? "lervo" : "team"]),
  );
}

/** Records the pending origins; returns how many records it wrote. */
export async function recordPendingAgentOrigins(root: string): Promise<number> {
  const origins = await pendingAgentOrigins(root);
  if (origins.size === 0) return 0;
  return (await recordAgentOrigins({ repositoryRoot: root, origins })).recordedCount;
}
