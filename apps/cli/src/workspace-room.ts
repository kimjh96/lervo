// An agent joining a conversation, and where the owner's turn goes (Lervo ADE rooms).
import { randomUUID } from "node:crypto";

import type { HostedLaunch } from "@lervo/adapter-contract";
import { MAXIMUM_ROOM_AGENTS } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import {
  launchArgumentDigest,
  roomSessionRecords,
  type HostedLaunchRecord,
} from "./hosted-launch-records.js";
import { launchPreparedEvent, type HostedSessionEventOutcome } from "./hosted-session-events.js";
import {
  hostedSessionHooks,
  settingsFileDigest,
  writeHostedSessionSettings,
} from "./hosted-session-settings.js";
import { hostedTerminalHooks, writtenTerminalHooks } from "./hosted-terminal-hooks.js";
import { mentionedAgents } from "./room-mentions.js";
import { locateWorkspaceSession, recordEvents, recordLaunch } from "./workspace-launch-service.js";
import { teamAgents, withAgentEnvironment } from "./workspace-participants.js";
import { agentLaunchModel } from "./agent-launch-model.js";

const AGENT_ID = /^agt_[a-f0-9]{24}$/u;

export interface RoomJoinResult {
  schemaVersion: 1;
  status: "joined";
  workspaceId: string;
  sessionId: string;
  agentId: string;
  provider: string;
  resumed: boolean;
  transcript: boolean;
  launch: HostedLaunch;
  hostedEvents: HostedSessionEventOutcome | "unavailable";
}

function stringArgument(arguments_: Record<string, unknown>, name: string): string {
  const value = arguments_[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 65_536)
    throw new CommandFailure("room_request_invalid", `${name} must be a non-empty string.`);
  return value;
}

/**
 * Prepares an agent's session in a conversation (Lervo ADE rooms, "The core link and the session
 * host"). An agent with a session there continues it; any other active team agent joins with a
 * new session that reads the lead's worktree, starting from `instruction`.
 */
export async function joinWorkspaceRoom(
  arguments_: Record<string, unknown>,
): Promise<RoomJoinResult> {
  const workspaceId = stringArgument(arguments_, "workspaceId");
  const agentId = stringArgument(arguments_, "agentId");
  if (!AGENT_ID.test(agentId))
    throw new CommandFailure("room_request_invalid", "agentId must be an agent ID.");
  const { path, previous, workingDirectory, adapter, repositoryRoot } =
    await locateWorkspaceSession(workspaceId);
  if (previous.conversationMode !== "native")
    throw new CommandFailure(
      "room_mode_unsupported",
      "Agents join only a conversation in the native mode.",
    );
  const sessions = await roomSessionRecords(path, workspaceId);
  const own = sessions.find((record) => record.agentId === agentId);
  if (own === undefined) {
    if (!(await teamAgents(repositoryRoot)).some((agent) => agent.agentId === agentId))
      throw new CommandFailure(
        "mention_target_inactive",
        `${agentId} is not an active agent of the project's team.`,
      );
    if (sessions.length >= MAXIMUM_ROOM_AGENTS)
      throw new CommandFailure(
        "room_full",
        `A conversation holds at most ${MAXIMUM_ROOM_AGENTS} agents.`,
      );
    if (!adapter.capabilities.readAccess)
      throw new CommandFailure(
        "access_unsupported",
        "This provider cannot run a session with read access.",
      );
  }
  const resume = own !== undefined && adapter.capabilities.resume;
  const access = own === undefined || own.access === "read" ? "read" : "write";
  const sessionId = resume ? own.sessionId : randomUUID();
  const start = resume
    ? ({ kind: "resume" } as const)
    : ({ kind: "new", instruction: stringArgument(arguments_, "instruction") } as const);
  const sessionHooks = hostedSessionHooks(adapter, sessionId);
  const terminal =
    sessionHooks === undefined ? undefined : await hostedTerminalHooks(adapter, workingDirectory);
  const hooks =
    sessionHooks === undefined || terminal === undefined
      ? sessionHooks
      : { ...sessionHooks, terminal };
  const chosen = await agentLaunchModel(repositoryRoot, agentId, adapter);
  const launch = withAgentEnvironment(
    adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory,
      ...chosen,
      start,
      ...(hooks === undefined ? {} : { hooks }),
      ...(access === "read" ? { access } : {}),
    }),
    agentId,
  );
  if (launch.settingsFile !== null) await writeHostedSessionSettings(launch.settingsFile);
  const written =
    terminal === undefined ? undefined : writtenTerminalHooks(terminal, launch.settingsFile);
  // Only the lead's record names the participants the conversation started with.
  const { terminalHooks: _leadTerminal, participants, ...lead } = previous;
  const record: HostedLaunchRecord = {
    ...lead,
    ...(access === "write" && participants !== undefined ? { participants } : {}),
    ...(written === undefined ? {} : { terminalHooks: written }),
    sessionId,
    agentId,
    ...(access === "read" ? { access } : {}),
    conversationMode: "native",
    argumentDigest: launchArgumentDigest(launch),
    settingsDigest: launch.settingsFile === null ? null : settingsFileDigest(launch.settingsFile),
    preparedAt: new Date().toISOString(),
  };
  await recordLaunch(record);
  const hostedEvents = await recordEvents(repositoryRoot, [launchPreparedEvent(record)]);
  return {
    schemaVersion: 1,
    status: "joined",
    workspaceId,
    sessionId,
    agentId,
    provider: adapter.provider,
    resumed: resume,
    // The transcript the core reads is the lead's session's, so a joined agent's session keeps
    // its history in its own conversation index instead.
    transcript: false,
    launch,
    hostedEvents,
  };
}

/**
 * The agents an owner's turn goes to (Lervo ADE rooms, "Routing"): those it mentions, in order,
 * or else the lead. A conversation whose lead has no agent answers none, and the turn goes to its
 * session as before.
 */
export async function routeRoomTurn(
  arguments_: Record<string, unknown>,
): Promise<{ agents: string[] }> {
  const workspaceId = stringArgument(arguments_, "workspaceId");
  const text = stringArgument(arguments_, "text");
  const { previous, repositoryRoot } = await locateWorkspaceSession(workspaceId);
  const mentioned = mentionedAgents(text, await teamAgents(repositoryRoot));
  if (mentioned.length > 0) return { agents: mentioned.slice(0, MAXIMUM_ROOM_AGENTS) };
  return { agents: previous.agentId === undefined ? [] : [previous.agentId] };
}
