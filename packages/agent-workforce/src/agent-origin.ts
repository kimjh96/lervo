import { registry } from "./agent-registry.js";
import type { AgentOrigin } from "./types.js";
import { retryConcurrent, transition } from "./workforce-state-io.js";

/**
 * Records `origin` on agents that lack it, once (ADR-0643). The caller decides each origin, since
 * telling Lervo's own agents from the team needs the knowledge convergence delegation, which this
 * package does not read. An agent that already records an origin keeps it. The registry is local
 * operational state, so the migration records no event.
 */
export async function recordAgentOrigins(input: {
  repositoryRoot: string;
  origins: ReadonlyMap<string, AgentOrigin>;
  now?: Date;
}): Promise<{ recordedCount: number }> {
  return retryConcurrent(async () => {
    const current = await registry(input.repositoryRoot);
    let recordedCount = 0;
    const agents = current.value.agents.map((agent) => {
      const origin = input.origins.get(agent.agentId);
      if (agent.origin !== undefined || origin === undefined) return agent;
      recordedCount += 1;
      return { ...agent, origin };
    });
    if (recordedCount === 0) return { recordedCount };
    return transition({
      path: current.path,
      lockPath: current.lockPath,
      now: input.now ?? new Date(),
      content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
      result: { recordedCount },
      expectedBefore: current.source,
    });
  });
}
