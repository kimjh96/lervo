// What the resident core loads about a session's conversation (Lervo ADE rooms, "Routing").
import {
  defaultRepositoryRegistryPath,
  resolveRegisteredRepository,
} from "@lervo/repository-registry";

import {
  hostedLaunchRecordsPath,
  latestHostedLaunchOfSession,
  roomSessionRecords,
} from "./hosted-launch-records.js";
import type { RoomContext } from "./room-router.js";
import { teamAgents } from "./workspace-participants.js";

/**
 * The conversation of a session that carries an agent: the project's team and each agent's session
 * there. A session without an agent, or of a project no longer registered, has none.
 */
export async function loadRoomContext(sessionId: string): Promise<RoomContext | null> {
  const path = hostedLaunchRecordsPath();
  const record = await latestHostedLaunchOfSession(path, sessionId);
  if (record?.agentId === undefined) return null;
  const repository = await resolveRegisteredRepository({
    registryPath: defaultRepositoryRegistryPath(),
    projectId: record.projectId,
  }).catch(() => null);
  if (repository === null) return null;
  const sessions = new Map<string, string>();
  for (const room of await roomSessionRecords(path, record.workspaceId))
    if (room.agentId !== undefined) sessions.set(room.agentId, room.sessionId);
  return {
    workspaceId: record.workspaceId,
    projectId: record.projectId,
    agentId: record.agentId,
    team: await teamAgents(repository.repositoryRoot),
    sessions,
  };
}

function named(agents: readonly { displayName: string; roleName: string }[]): string {
  return agents.map((agent) => `${agent.displayName} (${agent.roleName})`).join(", ");
}

/**
 * What a hosted session with an agent learns at its start (Lervo ADE rooms, "What each session
 * knows"): who it is, who else is in the conversation and on the team, and how a mention works.
 * Null for a session without an agent or a conversation.
 */
export async function roomBlock(sessionId: string): Promise<string | null> {
  const context = await loadRoomContext(sessionId);
  const self = context?.team.find((agent) => agent.agentId === context.agentId);
  if (context === null || self === undefined) return null;
  const others = context.team.filter((agent) => agent.agentId !== self.agentId);
  const present = others.filter((agent) => context.sessions.has(agent.agentId));
  return [
    `Lervo room: you are ${self.displayName}, the ${self.roleName}, in this conversation${
      present.length === 0 ? "" : ` with ${named(present)}`
    }.`,
    others.length === 0 ? null : `The project's team: ${named(others)}.`,
    "When your work needs another agent's role or what it knows, write @Name in your reply. Your message reaches that agent, and its answer comes back to you as a turn. Mention the product owner only for priorities and decisions; never route work through it. A mention grants no access beyond your own.",
    `When work is your own and belongs apart from this conversation, start a conversation you lead: run \`lervo workspace start --repository ${context.projectId} --started-by ${self.agentId} --title "<title>" --json\` with its first turn on standard input. It opens when your turn ends. Never start one for work this conversation already covers.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}
