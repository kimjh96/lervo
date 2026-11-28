import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { afterEach, describe, expect, it } from "vitest";

import { RoomLink } from "../src/room-link.js";
import { RoomRouter } from "../src/room-router.js";
import {
  AGENT_SENDS_PER_HOUR,
  dropPendingSend,
  pendingSendsOf,
  recordPendingSend,
  type PendingSend,
} from "../src/room-sends.js";

const team = [
  { agentId: "agt_bora", displayName: "Bora", roleName: "Product Owner" },
  { agentId: "agt_mach", displayName: "Machining", roleName: "Developer" },
];
const send: PendingSend = {
  sendId: "snd_1",
  workspaceId: "wsp_mach",
  agentId: "agt_mach",
  sessionId: "s-mach",
  title: "Port the verifier",
  sentBy: "agt_bora",
  text: "Review step 1, then start step 2.",
  preparedAt: "2026-11-28T00:00:00.000Z",
};
const tool: HostedDecodedEvent = {
  kind: "item",
  content: { kind: "tool_activity", name: "Bash", status: "succeeded", calls: 1 },
  createdAtMs: 1,
};
const ended: HostedDecodedEvent = { kind: "status", event: "turn_finished" };

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("work an agent sends to a teammate's conversation", () => {
  it("keeps each send until it is delivered, within the hourly backstop", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lervo-room-sends-"));
    directories.push(directory);
    const path = join(directory, "room-sends.json");
    const at = new Date("2026-11-28T00:00:00.000Z");
    const { sendId: _sendId, preparedAt: _preparedAt, ...request } = send;
    const recorded = await recordPendingSend(path, request, at);
    expect(recorded).toMatchObject({ workspaceId: "wsp_mach", sentBy: "agt_bora" });
    expect(await pendingSendsOf(path, "agt_bora", at)).toHaveLength(1);
    // Only the sender's turn delivers it.
    expect(await pendingSendsOf(path, "agt_mach", at)).toEqual([]);
    await dropPendingSend(path, recorded?.sendId ?? "", at);
    expect(await pendingSendsOf(path, "agt_bora", at)).toEqual([]);
    // Past the backstop the next send is refused; an hour later it is allowed again.
    for (let index = 1; index < AGENT_SENDS_PER_HOUR; index += 1)
      expect(await recordPendingSend(path, request, at)).not.toBeNull();
    expect(await recordPendingSend(path, request, at)).toBeNull();
    expect(
      await recordPendingSend(path, request, new Date(at.getTime() + 60 * 60_000 + 1)),
    ).not.toBeNull();
  });

  it("delivers a send to the lead's session once, at the sender's turn end, and settles it", async () => {
    const tasks: Promise<void>[] = [];
    const settled: string[] = [];
    let waiting: PendingSend[] = [];
    const link = new RoomLink(
      () =>
        Promise.resolve({
          workspaceId: "wsp_main",
          projectId: "prj_1",
          agentId: "agt_bora",
          team,
          sessions: new Map([["agt_bora", "s-bora"]]),
        }),
      (task) => void tasks.push(task),
      () => Promise.resolve([]),
      undefined,
      undefined,
      undefined,
      {
        load: () => Promise.resolve(waiting),
        settle: (sendId) => {
          settled.push(sendId);
          return Promise.resolve();
        },
      },
    );
    link.opened("d1", "s-bora", true);
    await Promise.all(tasks.splice(0));
    waiting = [send];
    expect(link.output("d1", "s-bora", [tool]).deliveries ?? []).toEqual([]);
    await Promise.all(tasks.splice(0));
    const sent = link.output("d1", "s-bora", [ended]);
    expect(sent.deliveries).toMatchObject([
      { workspaceId: "wsp_mach", agentId: "agt_mach", sessionId: "s-mach" },
    ]);
    expect(sent.deliveries?.[0]?.text).toContain(
      "[Lervo room] From Bora (Product Owner):\nReview step 1, then start step 2.",
    );
    expect(sent.deliveries?.[0]?.text).toContain(
      "Bora sent you this work from another conversation",
    );
    expect(sent.events.at(-1)).toMatchObject({
      content: {
        code: "work_sent",
        parameters: { title: "Port the verifier", workspace: "wsp_mach" },
      },
    });
    await Promise.all(tasks.splice(0));
    expect(settled).toEqual(["snd_1"]);
    // A later turn never sends it again.
    expect(link.output("d1", "s-bora", [ended]).deliveries ?? []).toEqual([]);
  });

  it("opens the lead's turn with who sent the work, and from where", () => {
    const router = new RoomRouter(
      () => 1,
      () => "dlv_1",
    );
    router.know("s-bora", {
      workspaceId: "wsp_main",
      projectId: "prj_1",
      agentId: "agt_bora",
      team,
      sessions: new Map([["agt_bora", "s-bora"]]),
    });
    const sent = router.sends("s-bora", [send]);
    const text = sent.deliveries[0]?.text ?? "";
    router.know("s-mach", {
      workspaceId: "wsp_mach",
      projectId: "prj_1",
      agentId: "agt_mach",
      team,
      sessions: new Map([["agt_mach", "s-mach"]]),
    });
    const shown = router.sent("s-mach", "dlv_1", [
      { kind: "item", content: { kind: "user_message", text }, createdAtMs: 1 },
    ]);
    expect(shown.map((event) => (event.kind === "item" ? event.content : null))).toEqual([
      {
        kind: "lervo_notice",
        code: "work_sent_from",
        parameters: { agent: "Bora", workspace: "wsp_main" },
      },
      { kind: "peer_message", from: "Bora", text: "Review step 1, then start step 2." },
    ]);
  });
});
