import { listAgents } from "@lervo/agent-workforce";
import type { HostedLaunch } from "@lervo/adapter-contract";
import { lervoAgentIds, loadConvergenceDelegation } from "@lervo/repository-knowledge-runtime";

import { CommandFailure } from "./command-error-output.js";

/** How many agents one conversation may start with (Lervo ADE agents, "Participants"). */
const MAXIMUM_PARTICIPANTS = 8;
const AGENT_ID = /^agt_[a-f0-9]{24}$/u;

export interface WorkspaceParticipants {
  /** The participant whose session writes: the first one chosen. */
  readonly agentId: string;
  readonly participants: readonly string[];
}

/**
 * The participants a new conversation starts with: active team agents of the project, without
 * repeats, the first of them writing (ADR-0222's one writer per worktree generation). Lervo's own
 * agents never take part (ADR-0643). Absent participants start the conversation without an agent.
 */
export async function resolveParticipants(
  repositoryRoot: string,
  requested: unknown,
): Promise<WorkspaceParticipants | undefined> {
  if (requested === undefined) return undefined;
  if (
    !Array.isArray(requested) ||
    requested.length === 0 ||
    requested.length > MAXIMUM_PARTICIPANTS ||
    !requested.every((id) => typeof id === "string" && AGENT_ID.test(id)) ||
    new Set(requested).size !== requested.length
  )
    throw new CommandFailure(
      "participant_invalid",
      `participants is 1 to ${MAXIMUM_PARTICIPANTS} distinct agent IDs.`,
    );
  const agents = await listAgents(repositoryRoot, { readOnly: true });
  const delegation =
    (await loadConvergenceDelegation(repositoryRoot).catch(() => null))?.delegation ?? null;
  const lervos = lervoAgentIds(agents, delegation);
  for (const id of requested as string[]) {
    const agent = agents.find((item) => item.agentId === id);
    const lervo = agent?.origin === "lervo" || (agent?.origin === undefined && lervos.has(id));
    if (agent === undefined || agent.status !== "active" || lervo)
      throw new CommandFailure(
        "participant_invalid",
        `${id} is not an active agent of the project's team.`,
      );
  }
  return { agentId: requested[0] as string, participants: requested as string[] };
}

/**
 * The launch with the writing agent named in its provider process's environment, so the session's
 * hooks and turn evidence attribute its work (Lervo ADE agents, "Participants and sessions").
 */
export function withAgentEnvironment(launch: HostedLaunch, agentId: string | undefined) {
  if (agentId === undefined) return launch;
  return { ...launch, environment: { ...launch.environment, LERVO_AGENT_ID: agentId } };
}
