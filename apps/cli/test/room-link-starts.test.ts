import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { describe, expect, it } from "vitest";

import { RoomLink } from "../src/room-link.js";
import type { PendingStart } from "../src/room-starts.js";

const team = [{ agentId: "agt_ciel", displayName: "Ciel", roleName: "Developer" }];
const start: PendingStart = {
  workspaceId: "wsp_new",
  agentId: "agt_ciel",
  title: "Fix retry budget",
  text: "Fix the retry budget.",
  preparedAt: "2026-11-27T00:00:00.000Z",
};
const tool: HostedDecodedEvent = {
  kind: "item",
  content: { kind: "tool_activity", name: "Bash", status: "succeeded", calls: 1 },
  createdAtMs: 1,
};
const ended: HostedDecodedEvent = { kind: "status", event: "turn_finished" };

describe("conversations an agent started, at its turn's end", () => {
  it("rereads the agent's starts after a tool line and opens each one once", async () => {
    const tasks: Promise<void>[] = [];
    let waiting: PendingStart[] = [];
    const link = new RoomLink(
      () =>
        Promise.resolve({
          workspaceId: "wsp_1",
          projectId: "prj_1",
          agentId: "agt_ciel",
          team,
          sessions: new Map([["agt_ciel", "s-ciel"]]),
        }),
      (task) => void tasks.push(task),
      () => Promise.resolve(waiting),
    );
    link.opened("d1", "s-ciel", true);
    await Promise.all(tasks.splice(0));

    // The command that records the start shows as a tool line; the reread follows it.
    waiting = [start];
    expect(link.output("d1", "s-ciel", [tool]).deliveries ?? []).toEqual([]);
    await Promise.all(tasks.splice(0));
    const opened = link.output("d1", "s-ciel", [ended]);
    expect(opened.deliveries).toMatchObject([{ workspaceId: "wsp_new", sessionId: null }]);
    expect(opened.events.at(-1)).toMatchObject({
      content: { code: "conversation_started", parameters: { workspace: "wsp_new" } },
    });
    // A later turn of the agent never opens it again.
    expect(link.output("d1", "s-ciel", [ended]).deliveries ?? []).toEqual([]);
  });
});
