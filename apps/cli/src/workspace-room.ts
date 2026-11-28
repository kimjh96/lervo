// An agent joining a conversation, and where the owner's turn goes (Lervo ADE rooms).
import { randomUUID } from "node:crypto";

import type { HostedLaunch } from "@lervo/adapter-contract";
import { MAXIMUM_ROOM_AGENTS } from "@lervo/session-host-contract";

import { CommandFailure } from "./command-error-output.js";
import {
  isConversationLead,
  launchArgumentDigest,
  listedTime,
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
import { dropPendingStart, pendingStart, pendingStartsPath } from "./room-starts.js";
import {
  locateWorkspaceSession,
  recordEvents,
  recordLaunch,
  startWorkspaceFromInstruction,
} from "./workspace-launch-service.js";
import { teamAgents } from "./workspace-participants.js";
import { worktreeOfBranch } from "./workspace-start-effects.js";
import { workstreamTitle } from "./workstream-title.js";
import { withSessionEnvironment } from "./hosted-session-environment.js";
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
  /**
   * The conversation's own session: its lead, opening from the first turn of a conversation that
   * started for it, or resuming to receive a turn, such as work a teammate sent (ADR-0657).
   */
  lead?: true;
}

function stringArgument(arguments_: Record<string, unknown>, name: string): string {
  const value = arguments_[name];
  if (typeof value !== "string" || value.length === 0 || value.length > 65_536)
    throw new CommandFailure("room_request_invalid", `${name} must be a non-empty string.`);
  return value;
}

/**
 * Prepares an agent's session in a conversation (Lervo ADE rooms, "The core link and the session
 * host"). An agent with a session there continues it. Any other active team agent joins as a
 * member: Lervo prepares its own member workspace, where its new session writes, starting from
 * `instruction` (ADR-0661).
 */
export async function joinWorkspaceRoom(
  arguments_: Record<string, unknown>,
): Promise<RoomJoinResult> {
  const workspaceId = stringArgument(arguments_, "workspaceId");
  const agentId = stringArgument(arguments_, "agentId");
  if (!AGENT_ID.test(agentId))
    throw new CommandFailure("room_request_invalid", "agentId must be an agent ID.");
  const located = await locateWorkspaceSession(workspaceId);
  if (located.previous.conversationMode !== "native")
    throw new CommandFailure(
      "room_mode_unsupported",
      "Agents join only a conversation in the native mode.",
    );
  const sessions = await roomSessionRecords(located.path, workspaceId);
  const own = sessions.find((record) => record.agentId === agentId);
  if (own === undefined) {
    if (!(await teamAgents(located.repositoryRoot)).some((agent) => agent.agentId === agentId))
      throw new CommandFailure(
        "mention_target_inactive",
        `${agentId} is not an active agent of the project's team.`,
      );
    if (sessions.length >= MAXIMUM_ROOM_AGENTS)
      throw new CommandFailure(
        "room_full",
        `A conversation holds at most ${MAXIMUM_ROOM_AGENTS} agents.`,
      );
    return joinAsMember(workspaceId, agentId, located, stringArgument(arguments_, "instruction"));
  }
  if (own.room === undefined) return continueSession(arguments_, own, located);
  // A member continues in its own workspace; one whose worktree is gone is prepared again.
  const worktree = await worktreeOfBranch(located.repositoryRoot, own.branch);
  return worktree === null
    ? joinAsMember(workspaceId, agentId, located, stringArgument(arguments_, "instruction"))
    : continueSession(arguments_, own, { ...located, workingDirectory: worktree });
}

type LocatedConversation = Awaited<ReturnType<typeof locateWorkspaceSession>>;

/**
 * Starts `agentId`'s member workspace of the conversation (ADR-0661): its own worktree, branch,
 * and coordination, from the fetched upstream tip, with a new session that writes there.
 */
async function joinAsMember(
  workspaceId: string,
  agentId: string,
  conversation: LocatedConversation,
  instruction: string,
): Promise<RoomJoinResult> {
  const { previous, workingDirectory, repositoryRoot } = conversation;
  const member = (await teamAgents(repositoryRoot)).find((agent) => agent.agentId === agentId);
  const topic = (await workstreamTitle(workingDirectory)) ?? previous.branch;
  const started = await startWorkspaceFromInstruction({
    repository: previous.projectId,
    provider: previous.provider,
    mode: "native",
    instruction,
    participants: [agentId],
    title: `${member?.displayName ?? agentId}: ${topic}`,
    room: workspaceId,
    ...(previous.questions === true ? { questions: true } : {}),
  });
  return {
    schemaVersion: 1,
    status: "joined",
    workspaceId,
    sessionId: started.sessionId,
    agentId,
    provider: started.provider,
    resumed: false,
    transcript: false,
    launch: started.launch,
    hostedEvents: started.hostedEvents,
  };
}

/**
 * Prepares the launch that continues `own`, an agent's session in the conversation, in
 * `conversation.workingDirectory`: the lead's worktree for the lead and a joined agent that reads,
 * or a member's own worktree.
 */
async function continueSession(
  arguments_: Record<string, unknown>,
  own: HostedLaunchRecord,
  conversation: LocatedConversation,
): Promise<RoomJoinResult> {
  const { previous, workingDirectory, adapter, repositoryRoot } = conversation;
  const workspaceId = previous.workspaceId;
  const agentId = own.agentId!;
  const leads = isConversationLead(own, workspaceId);
  // The lead of a conversation it started opens its prepared session from the delivered turn.
  const starting = leads ? await pendingStart(pendingStartsPath(), workspaceId, agentId) : null;
  const resume = starting === null && adapter.capabilities.resume;
  const sessionId = resume || starting !== null ? own.sessionId : randomUUID();
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
  const reads = own.access === "read";
  const launch = withSessionEnvironment(
    adapter.prepareLaunch({
      sessionId,
      mode: "native",
      workingDirectory,
      ...chosen,
      start,
      ...(hooks === undefined ? {} : { hooks }),
      ...(reads ? { access: "read" as const } : {}),
      // Every session of the conversation asks as its lead does.
      ...(previous.questions === true ? { questions: true } : {}),
    }),
    agentId,
  );
  if (launch.settingsFile !== null) await writeHostedSessionSettings(launch.settingsFile);
  const written =
    terminal === undefined ? undefined : writtenTerminalHooks(terminal, launch.settingsFile);
  const preparedAt = new Date().toISOString();
  // A member's record keeps its own workspace; the lead's, and a reader's, the conversation's.
  // Only the lead's record names the participants the conversation started with.
  const {
    terminalHooks: _terminal,
    participants,
    startedBy,
    ...kept
  } = own.room === undefined ? previous : own;
  const record: HostedLaunchRecord = {
    ...kept,
    ...(leads && participants !== undefined ? { participants } : {}),
    ...(leads && startedBy !== undefined ? { startedBy } : {}),
    ...(written === undefined ? {} : { terminalHooks: written }),
    sessionId,
    agentId,
    ...(reads ? { access: "read" as const } : {}),
    conversationMode: "native",
    argumentDigest: launchArgumentDigest(launch),
    settingsDigest: launch.settingsFile === null ? null : settingsFileDigest(launch.settingsFile),
    preparedAt,
    // Resuming a session, as opening the conversation does, keeps the conversation's place in
    // the list; a new session of a joined agent is activity.
    listedAt: resume ? listedTime(own) : preparedAt,
  };
  await recordLaunch(record);
  if (starting !== null) await dropPendingStart(pendingStartsPath(), workspaceId, agentId);
  const hostedEvents = await recordEvents(repositoryRoot, [launchPreparedEvent(record)]);
  return {
    schemaVersion: 1,
    status: "joined",
    workspaceId,
    sessionId,
    agentId,
    provider: adapter.provider,
    resumed: resume,
    // The transcript the core reads is the lead's session's, so another agent's session keeps
    // its history in its own conversation index instead.
    transcript: false,
    launch,
    hostedEvents,
    // The lead's own session opens as the conversation's, whether it starts or resumes here.
    ...(leads && (starting !== null || resume) ? { lead: true as const } : {}),
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
