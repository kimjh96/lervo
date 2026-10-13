import type { WorkforceAgent } from "@lervo/agent-workforce";
import {
  convergenceDelegationAgentIds,
  loadConvergenceDelegation,
} from "@lervo/repository-knowledge-runtime";

/**
 * Active agents that count against a mandate's `maximumWorkers`. Workers serving the repository's
 * reviewed convergence delegation are bounded by that delegation's fixed roles, not hired as
 * staff (ADR-0512). An unreadable delegation excludes nobody, so the count never shrinks on doubt.
 */
export async function countSupervisionStaff(
  repositoryRoot: string,
  agents: readonly WorkforceAgent[],
): Promise<number> {
  const active = agents.filter((agent) => agent.status === "active");
  const loaded = await loadConvergenceDelegation(repositoryRoot).catch(() => null);
  if (loaded === null) return active.length;
  const delegated = convergenceDelegationAgentIds(active, loaded.delegation);
  return active.filter((agent) => !delegated.has(agent.agentId)).length;
}
