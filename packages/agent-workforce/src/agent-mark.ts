// Each team agent's image (Lervo ADE agents, "The profile"): a mark the owner chooses, stored as a
// repository asset by its hash, as a project's mark is. The agent record keeps only the hash.
import { registry } from "./agent-registry.js";
import type { AgentMark, WorkforceAgent, WorkforceEventRecorder } from "./types.js";
import { AGENT_ID, fail, validAgentMark } from "./workforce-state-validation.js";
import { transition } from "./workforce-state-io.js";

/**
 * Sets a team agent's image, or clears it with `null`. The asset must already be stored; this
 * records which one the agent shows.
 */
export async function changeAgentMark(input: {
  repositoryRoot: string;
  agentId: string;
  expectedRevision: number;
  mark: AgentMark | null;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (!AGENT_ID.test(input.agentId) || (input.mark !== null && !validAgentMark(input.mark)))
    fail("agent_invalid", "The agent image transition is invalid.");
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = current.value.agents[index]!;
  if (
    existing.revision !== input.expectedRevision ||
    existing.status === "retired" ||
    existing.origin === "lervo"
  )
    fail("agent_state_conflict", "The agent revision, lifecycle, or origin conflicts.");
  const { mark: previous, ...rest } = existing;
  const agent: WorkforceAgent = {
    ...rest,
    ...(input.mark === null ? {} : { mark: { ...input.mark } }),
    revision: existing.revision + 1,
    updatedAt: now.toISOString(),
  };
  const agents = current.value.agents.map((candidate, candidateIndex) =>
    candidateIndex === index ? agent : candidate,
  );
  return transition({
    path: current.path,
    lockPath: current.lockPath,
    now,
    content: `${JSON.stringify({ ...current.value, agents }, null, 2)}\n`,
    result: structuredClone(agent),
    ...(input.recordEvent === undefined ? {} : { recordEvent: input.recordEvent }),
    expectedBefore: current.source,
    event: {
      type: "agent.identity.changed",
      occurredAt: agent.updatedAt,
      actorAgentId: input.actorAgentId ?? null,
      payload: {
        changeKind: "mark",
        agentId: agent.agentId,
        previousMarkSha256: previous?.sha256 ?? null,
        markSha256: input.mark?.sha256 ?? null,
        revision: agent.revision,
      },
    },
  });
}
