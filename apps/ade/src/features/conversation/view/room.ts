// The conversation's agents beyond its lead, as the conversation view uses them (Lervo ADE rooms).
import { useEffect, useMemo, useRef } from "react";
import { useIntl } from "react-intl";

import type { ApplicationCommands, SessionHost } from "../../../ports";
import { teamAgents, useAgentStore } from "../../agents";
import { reloadWorkspaces, useWorkspaceStore, visibleStatus } from "../../workspaces";
import { activityOf } from "../model/activity";
import { RoomMembers } from "../model/room-members";
import { useRoomStore } from "../model/room-store";
import type { Mentionable } from "./mentions";
import { activityMessages } from "./messages";

/**
 * Gives the owner's turn to the agents it mentions beyond the lead (Lervo ADE rooms, "Routing"):
 * a joined agent's session, or a new one that joins with the turn. True when the lead is not among
 * them, so the turn does not go to the lead too.
 */
async function routeToMembers(input: {
  host: SessionHost;
  commands: ApplicationCommands;
  room: RoomMembers | null;
  workspaceId: string;
  leadAgentId: string;
  text: string;
}): Promise<boolean> {
  const { host, commands, room, workspaceId, leadAgentId, text } = input;
  const routed = await commands.run("room.route", { workspaceId, text }).catch(() => null);
  const agents = routed?.agents ?? [];
  const others = agents.filter((agentId) => agentId !== leadAgentId);
  for (const agentId of others) {
    const member = room?.sessionOf(agentId);
    const delivered =
      member !== undefined &&
      (await host
        .request({ kind: "session.send", sessionId: member, text })
        .then(() => true)
        .catch(() => false));
    if (delivered) continue;
    const joined = await commands.run("room.join", { workspaceId, agentId, instruction: text });
    room?.follow({ agentId, sessionId: joined.sessionId });
  }
  return others.length > 0 && !agents.includes(leadAgentId);
}

/**
 * A conversation's room: it follows each joined agent's session, refreshes the list when an agent
 * joins, offers the agents the reply card's `@` mentions, routes the owner's mentions, and names
 * each working agent on the working line. Without a core that holds rooms, it does nothing.
 */
export function useRoom(input: {
  host: SessionHost;
  commands: ApplicationCommands;
  workspaceId: string | null;
  sessionId: string | null;
}) {
  const { host, commands, workspaceId, sessionId } = input;
  const intl = useIntl();
  const coreRooms = useWorkspaceStore(
    (store) => store.advertisedCommands?.includes("room.route") === true,
  );
  const workspace = useWorkspaceStore((store) =>
    store.workspaces.find((candidate) => candidate.workspaceId === workspaceId),
  );
  const leadAgentId = workspace?.agentId ?? null;
  const lanes = useRoomStore((store) => store.members);
  const statuses = useWorkspaceStore((store) => store.statuses);
  const agents = useAgentStore((store) => store.agents);

  // The reply card's `@` offers the conversation's agents first, then the rest of the team.
  const participants = workspace?.participants;
  const mentionables = useMemo((): Mentionable[] => {
    if (!coreRooms) return [];
    const team = teamAgents(agents);
    const here = participants ?? [];
    const of = (participant: boolean) =>
      team
        .filter((agent) => here.includes(agent.agentId) === participant)
        .map((agent) => ({
          agentId: agent.agentId,
          displayName: agent.displayName,
          roleName: agent.roleName,
          participant,
        }));
    return [...of(true), ...of(false)];
  }, [agents, participants, coreRooms]);

  const memberKey = (workspace?.sessions ?? [])
    .filter((session) => session.access === "read")
    .map((session) => `${session.agentId}=${session.sessionId}`)
    .join(",");
  const room = useRef<RoomMembers | null>(null);
  useEffect(() => {
    if (workspaceId === null || sessionId === null || !coreRooms) return;
    const created = new RoomMembers(host, commands, workspaceId, leadAgentId);
    room.current = created;
    return () => {
      created.close();
      if (room.current === created) room.current = null;
    };
  }, [host, commands, workspaceId, sessionId, coreRooms, leadAgentId]);
  useEffect(() => {
    for (const pair of memberKey === "" ? [] : memberKey.split(",")) {
      const [agentId = "", memberSession = ""] = pair.split("=");
      room.current?.follow({ agentId, sessionId: memberSession });
    }
  }, [memberKey, room]);

  // A session the list does not know, such as an agent's that just joined, refreshes the list,
  // which then names it among the conversation's sessions.
  const unknownSession = useWorkspaceStore((store) =>
    Object.keys(store.statuses).some(
      (id) =>
        !store.workspaces.some(
          (known) =>
            known.sessionId === id || known.sessions?.some((member) => member.sessionId === id),
        ),
    ),
  );
  useEffect(() => {
    if (unknownSession && coreRooms) void reloadWorkspaces(commands).catch(() => undefined);
  }, [unknownSession, coreRooms, commands]);

  const nameOf = (agentId: string | null) =>
    agents.find((agent) => agent.agentId === agentId)?.displayName ?? null;
  const named = (name: string, activity: string) =>
    intl.formatMessage({ id: "conversation.working.agent" }, { name, activity });

  return {
    mentionables,
    /** True when the owner's turn went to agents beyond the lead only. */
    route: (text: string): Promise<boolean> =>
      workspaceId === null || sessionId === null || !coreRooms || leadAgentId === null
        ? Promise.resolve(false)
        : routeToMembers({ host, commands, room: room.current, workspaceId, leadAgentId, text }),
    /**
     * The working line: the lead's activity as before, or, while joined agents work too, each
     * working agent and what it does on the one line, so the conversation never moves.
     */
    workingLine: (lead: string | null): string | null => {
      const members = Object.values(lanes)
        .filter((lane) => visibleStatus(statuses[lane.sessionId]) === "working")
        .map((lane) => {
          const doing = activityOf(lane.window);
          const activity = intl.formatMessage(
            activityMessages[doing.kind],
            doing.kind === "tool" ? { name: doing.name } : {},
          );
          return named(nameOf(lane.agentId) ?? "", activity);
        });
      if (members.length === 0) return lead;
      const leadName = nameOf(leadAgentId);
      const first = lead === null ? [] : [leadName === null ? lead : named(leadName, lead)];
      return [...first, ...members].join(", ");
    },
  };
}
