// Routing the owner's turn to the agents it mentions (Lervo ADE rooms, "Routing").
import { type ApplicationCommands, failureCode, type SessionHost } from "../../../ports";
import type { RoomMembers } from "./room-members";
import { useRoomStore } from "./room-store";

/**
 * Gives the owner's turn to the agents it mentions beyond the lead: a joined agent's running
 * session, or a session that joins with the turn. It answers true when the lead is not among them,
 * so the turn does not go to the lead too.
 *
 * When the core cannot route the turn, the lead receives it, and the room store keeps the core's
 * code, so the reply card says that the mentions went unrouted (ADE convention, "Core failures
 * stay visible"). A later routed turn clears it.
 */
export async function routeTurn(input: {
  host: SessionHost;
  commands: ApplicationCommands;
  room: RoomMembers | null;
  workspaceId: string;
  leadAgentId: string;
  text: string;
}): Promise<boolean> {
  const { host, commands, room, workspaceId, leadAgentId, text } = input;
  let agents: readonly string[];
  try {
    ({ agents } = await commands.run("room.route", { workspaceId, text }));
  } catch (failure) {
    useRoomStore.setState({ unrouted: failureCode(failure) });
    return false;
  }
  useRoomStore.setState({ unrouted: null });
  const others = agents.filter((agentId) => agentId !== leadAgentId);
  for (const agentId of others) {
    const member = room?.sessionOf(agentId);
    if (member !== undefined && (await delivered(host, member, text))) continue;
    // An agent without a running session, such as after the session host restarted, joins with
    // the turn as its instruction; a failure to join reaches the reply card.
    const joined = await commands.run("room.join", { workspaceId, agentId, instruction: text });
    room?.follow({ agentId, sessionId: joined.sessionId });
  }
  return others.length > 0 && !agents.includes(leadAgentId);
}

/**
 * Sends the turn to a joined agent's session. False when the session host could not take it, so
 * the agent rejoins with the turn instead, through the core.
 */
async function delivered(host: SessionHost, sessionId: string, text: string): Promise<boolean> {
  try {
    await host.request({ kind: "session.send", sessionId, text });
    return true;
  } catch {
    return false;
  }
}

/**
 * Gives a new conversation's first turn to the agents it mentions beyond the lead, as any later
 * turn of the owner's (Lervo ADE rooms, "Routing"). The lead's session starts from the turn
 * itself; each other mentioned agent joins with it as a member (ADR-0661). A core that cannot
 * route leaves the turn with the lead, and the room store keeps its code.
 */
export async function routeFirstTurn(input: {
  commands: ApplicationCommands;
  workspaceId: string;
  leadAgentId: string;
  text: string;
}): Promise<void> {
  const { commands, workspaceId, leadAgentId, text } = input;
  let agents: readonly string[];
  try {
    ({ agents } = await commands.run("room.route", { workspaceId, text }));
  } catch (failure) {
    useRoomStore.setState({ unrouted: failureCode(failure) });
    return;
  }
  for (const agentId of agents.filter((agent) => agent !== leadAgentId))
    await commands.run("room.join", { workspaceId, agentId, instruction: text });
}
