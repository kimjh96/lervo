import { registry } from "./agent-registry.js";
import { listAssignments } from "./assignment-state.js";
import { listWorkspaces } from "./workspace-store.js";
import { retryConcurrent, transition } from "./workforce-state-io.js";

/** Retired Lervo agents kept for inspection; older ones are removed (ADR-0643). */
export const RETAINED_RETIRED_LERVO_AGENTS = 32;

/**
 * Removes Lervo's retired agents beyond the latest `keep`, by when they last changed. Every
 * knowledge convergence renewal hires a fresh set of workers and retires the last one, so without
 * this the registry grows without bound. An agent that a listed assignment, a workspace that is not
 * removed, or another agent's parent link still names is kept until those are gone. Team agents
 * are never removed. The registry is local operational state; events keep the history.
 */
export async function pruneRetiredLervoAgents(input: {
  repositoryRoot: string;
  keep?: number;
  now?: Date;
}): Promise<{ prunedAgentIds: string[] }> {
  const keep = input.keep ?? RETAINED_RETIRED_LERVO_AGENTS;
  return retryConcurrent(async () => {
    const current = await registry(input.repositoryRoot);
    const retired = current.value.agents
      .filter((agent) => agent.origin === "lervo" && agent.status === "retired")
      .toSorted(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.agentId.localeCompare(right.agentId),
      );
    if (retired.length <= keep) return { prunedAgentIds: [] };
    const named = new Set<string>();
    for (const assignment of await listAssignments(input.repositoryRoot)) {
      if (assignment.assigneeAgentId !== null) named.add(assignment.assigneeAgentId);
      if (assignment.lease !== null) named.add(assignment.lease.agentId);
    }
    for (const workspace of await listWorkspaces(input.repositoryRoot))
      if (workspace.state !== "removed") named.add(workspace.agentId);
    for (const agent of current.value.agents)
      if (agent.parentAgentId !== null) named.add(agent.parentAgentId);
    const pruned = new Set(
      retired
        .slice(keep)
        .filter((agent) => !named.has(agent.agentId))
        .map((agent) => agent.agentId),
    );
    if (pruned.size === 0) return { prunedAgentIds: [] };
    const agents = current.value.agents.filter((agent) => !pruned.has(agent.agentId));
    return transition({
      path: current.path,
      lockPath: current.lockPath,
      now: input.now ?? new Date(),
      content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
      result: { prunedAgentIds: [...pruned] },
      expectedBefore: current.source,
    });
  });
}
