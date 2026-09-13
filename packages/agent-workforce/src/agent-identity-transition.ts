import { type WorkforceEventRecorder, type WorkforceAgent } from "./types.js";
import { AGENT_ID, fail } from "./workforce-state-validation.js";
import { validAgentDisplayName, withAgentDisplayIdentity } from "./agent-display-identity.js";
import { registry } from "./agent-registry.js";
import { transition } from "./workforce-state-io.js";

export async function changeAgentDisplayName(input: {
  repositoryRoot: string;
  agentId: string;
  expectedRevision: number;
  displayName: string;
  actorAgentId?: string;
  now?: Date;
  recordEvent?: WorkforceEventRecorder;
}): Promise<WorkforceAgent> {
  if (!AGENT_ID.test(input.agentId) || !validAgentDisplayName(input.displayName)) {
    fail("agent_invalid", "The agent display-name transition is invalid.");
  }
  const now = input.now ?? new Date();
  const current = await registry(input.repositoryRoot);
  const index = current.value.agents.findIndex((agent) => agent.agentId === input.agentId);
  if (index < 0) fail("agent_not_found", "The agent does not exist.");
  const existing = withAgentDisplayIdentity(current.value.agents[index]!);
  if (
    existing.revision !== input.expectedRevision ||
    existing.status === "retired" ||
    existing.displayName === input.displayName ||
    current.value.agents.some(
      (candidate) =>
        candidate.agentId !== input.agentId &&
        withAgentDisplayIdentity(candidate).displayName.localeCompare(
          input.displayName,
          undefined,
          {
            sensitivity: "accent",
          },
        ) === 0,
    )
  ) {
    fail("agent_state_conflict", "The agent revision, lifecycle, or display name conflicts.");
  }
  const agent: WorkforceAgent = {
    ...existing,
    displayName: input.displayName,
    displayNameSource: "explicit",
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
        changeKind: "display_name",
        agentId: agent.agentId,
        previousDisplayName: existing.displayName,
        displayName: agent.displayName,
        displayNameSource: agent.displayNameSource,
        revision: agent.revision,
      },
    },
  });
}
