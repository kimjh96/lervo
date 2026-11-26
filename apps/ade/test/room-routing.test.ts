import type { AgentSummary } from "@lervo/session-host-contract";
import { afterEach, describe, expect, it } from "vitest";

import { mentionablesOf } from "../src/features/conversation/model/mentionables";
import type { RoomMembers } from "../src/features/conversation/model/room-members";
import { routeTurn } from "../src/features/conversation/model/room-routing";
import { useRoomStore } from "../src/features/conversation/model/room-store";
import { type ApplicationCommands, RequestFailure, type SessionHost } from "../src/ports";

/** A core whose `room.route` answers `agents`, or fails with `failing`. */
function core(answer: { agents?: string[]; failing?: string }) {
  const calls: { command: string; input: Record<string, unknown> }[] = [];
  const commands = {
    async run(command: string, input: Record<string, unknown>) {
      calls.push({ command, input });
      if (command === "room.route") {
        if (answer.failing !== undefined) throw new RequestFailure(answer.failing);
        return { agents: answer.agents ?? [] };
      }
      return { sessionId: `ses_${String(input.agentId)}` };
    },
  };
  return { commands: commands as unknown as ApplicationCommands, calls };
}

/** A session host that takes a turn only for the sessions in `running`. */
function host(running: readonly string[]) {
  const sent: string[] = [];
  const fake = {
    async request(message: { kind: string; sessionId: string }) {
      if (!running.includes(message.sessionId)) throw new RequestFailure("session_not_found");
      sent.push(message.sessionId);
      return {};
    },
  };
  return { host: fake as unknown as SessionHost, sent };
}

/** A room whose joined agents run the given sessions. */
function room(sessions: Record<string, string>) {
  const followed: { agentId: string; sessionId: string }[] = [];
  const fake = {
    sessionOf: (agentId: string) => sessions[agentId],
    follow: (member: { agentId: string; sessionId: string }) => followed.push(member),
  };
  return { room: fake as unknown as RoomMembers, followed };
}

const route = (input: {
  host: SessionHost;
  commands: ApplicationCommands;
  room: RoomMembers | null;
}) => routeTurn({ ...input, workspaceId: "wsp_1", leadAgentId: "agt_lead", text: "@Arin look" });

afterEach(() => useRoomStore.setState({ unrouted: null }));

describe("routing the owner's turn to the agents it mentions", () => {
  it("gives a mentioned agent's running session the turn, and not the lead", async () => {
    const { commands } = core({ agents: ["agt_arin"] });
    const session = host(["ses_arin"]);
    const members = room({ agt_arin: "ses_arin" });
    await expect(route({ host: session.host, commands, room: members.room })).resolves.toBe(true);
    expect(session.sent).toEqual(["ses_arin"]);
    expect(members.followed).toEqual([]);
  });

  it("joins an agent whose session does not run, with the turn as its instruction", async () => {
    const { commands, calls } = core({ agents: ["agt_arin"] });
    const members = room({ agt_arin: "ses_stopped" });
    await expect(route({ host: host([]).host, commands, room: members.room })).resolves.toBe(true);
    expect(calls.at(-1)).toEqual({
      command: "room.join",
      input: { workspaceId: "wsp_1", agentId: "agt_arin", instruction: "@Arin look" },
    });
    expect(members.followed).toEqual([{ agentId: "agt_arin", sessionId: "ses_agt_arin" }]);
  });

  it("keeps the lead's turn when the lead is mentioned too, or no one is", async () => {
    const both = core({ agents: ["agt_lead", "agt_arin"] });
    const members = room({ agt_arin: "ses_arin" });
    await expect(
      route({ host: host(["ses_arin"]).host, commands: both.commands, room: members.room }),
    ).resolves.toBe(false);
    await expect(
      route({ host: host([]).host, commands: core({ agents: [] }).commands, room: null }),
    ).resolves.toBe(false);
  });

  it("gives the lead the turn and keeps the core's code when routing fails, until a turn routes", async () => {
    const failing = core({ failing: "application_unavailable" });
    await expect(
      route({ host: host([]).host, commands: failing.commands, room: null }),
    ).resolves.toBe(false);
    expect(useRoomStore.getState().unrouted).toBe("application_unavailable");
    await expect(
      route({ host: host([]).host, commands: core({ agents: [] }).commands, room: null }),
    ).resolves.toBe(false);
    expect(useRoomStore.getState().unrouted).toBeNull();
  });
});

const agent = (agentId: string, origin: "team" | "lervo" = "team") =>
  ({ agentId, displayName: agentId, roleName: "Developer", origin }) as unknown as AgentSummary;

describe("the agents the reply card's @ offers", () => {
  it("offers the conversation's agents first, then the rest of the team, never Lervo's own", () => {
    const offered = mentionablesOf(
      [agent("agt_a"), agent("agt_b"), agent("agt_steward", "lervo"), agent("agt_c")],
      ["agt_c", "agt_steward"],
    );
    expect(offered.map((item) => [item.agentId, item.participant])).toEqual([
      ["agt_c", true],
      ["agt_a", false],
      ["agt_b", false],
    ]);
  });
});
