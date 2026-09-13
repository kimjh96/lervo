import { type AgentStatus, type WorkforceEventRecorder, type WorkforceAgent } from "./types.js";
import { AGENT_ID, fail } from "./workforce-state-validation.js";
import { registry } from "./agent-registry.js";
import { transition } from "./workforce-state-io.js";

export async function changeAgentStatus(input: {
  repositoryRoot: string;
  agentId: string;
  expectedRevision: number;
  status: AgentStatus;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (!AGENT_ID.test(input.agentId) || !["active", "suspended", "retired"].includes(input.status))
    fail("agent_invalid", "The agent transition is invalid.");
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = current.value.agents[index]!;
  if (
    existing.revision !== input.expectedRevision ||
    existing.status === "retired" ||
    existing.status === input.status
  )
    fail("agent_state_conflict", "The agent revision or lifecycle transition is stale.");
  const agent = {
    ...existing,
    status: input.status,
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  };
  const agents = [...current.value.agents];
  agents[index] = agent;
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.status.changed",
      occurredAt: agent.updatedAt,
      actorAgentId: input.actorAgentId ?? null,
      payload: {
        agentId: agent.agentId,
        previousStatus: existing.status,
        status: agent.status,
        revision: agent.revision,
      },
    },
  });
}
