import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { RoomLink } from "../src/room-link.js";
import type { RoomContext } from "../src/room-router.js";

const elio = { agentId: "agt_elio", displayName: "Elio", roleName: "Product Owner" };
const eren = { agentId: "agt_eren", displayName: "Eren", roleName: "Developer" };

function said(text: string): HostedDecodedEvent[] {
  return [
    { kind: "item", content: { kind: "agent_message", text }, createdAtMs: 1 },
    { kind: "status", event: "turn_finished" },
  ];
}

describe("a conversation's room at each turn", () => {
  it("stops delivering to an agent paused since the session opened", async () => {
    const tasks: Promise<void>[] = [];
    let team = [elio, eren];
    const link = new RoomLink(
      (): Promise<RoomContext> =>
        Promise.resolve({
          workspaceId: "wsp_1",
          projectId: "prj_1",
          agentId: "agt_elio",
          team,
          sessions: new Map([
            ["agt_elio", "s-elio"],
            ["agt_eren", "s-eren"],
          ]),
        }),
      (task) => void tasks.push(task),
    );
    link.opened("d1", "s-elio", true);
    await Promise.all(tasks.splice(0));
    expect(link.output("d1", "s-elio", said("@Eren please check.")).deliveries).toHaveLength(1);

    // Eren is paused; the next turn rereads the room before it ends.
    team = [elio];
    link.sent("d1", "s-elio", undefined, []);
    await Promise.all(tasks.splice(0));
    expect(link.output("d1", "s-elio", said("@Eren please check again.")).deliveries).toEqual([]);
  });
});
