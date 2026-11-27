import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { providerSessionDigest } from "../src/hosted-session-events.js";
import { runCli } from "../src/main.js";
import { answersElsewhere } from "../src/room-answers.js";
import { appendRoomEvents, mentionIdOf, type RoomEvent } from "../src/room-events.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const own = `wsp_${"a".repeat(24)}`;
const logFormat = `wsp_${"b".repeat(24)}`;
const ciel = `agt_${"1".repeat(24)}`;
const iris = `agt_${"2".repeat(24)}`;
const arin = `agt_${"3".repeat(24)}`;

function io(cwd: string, stdin = "") {
  const stdout: string[] = [];
  return {
    stdout,
    io: {
      cwd,
      stdout: (message: string) => stdout.push(message),
      stderr: () => undefined,
      stdin: async () => stdin,
    },
  };
}

const mention = (
  delivery: string,
  workspaceId: string,
  toAgentId: string,
  at: string,
  delivered = true,
): RoomEvent[] => [
  {
    type: "room.mention.recorded",
    payload: {
      workspaceId,
      mentionId: mentionIdOf(delivery),
      fromAgentId: iris,
      toAgentId,
      depth: 1,
      occurredAt: at,
    },
  },
  ...(delivered
    ? [
        {
          type: "room.mention.delivered" as const,
          payload: {
            mentionId: mentionIdOf(delivery),
            providerSessionDigest: providerSessionDigest("claude", delivery),
            occurredAt: at,
          },
        },
      ]
    : []),
];

describe("what a conversation's lead answered elsewhere", () => {
  it("lists the mentions delivered to it in other conversations, newest first", async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-room-answers-")));
    roots.push(root);
    expect(await runCli(["init", "--root", root, "--name", "answers"], io(root).io)).toBe(0);
    const evidence = io(root);
    expect(await runCli(["event-contract", "evidence", "--root", root], evidence.io)).toBe(0);
    const activate = ["event-contract", "activate", "--stdin", "--schema-version", "15"];
    const planned = io(root, evidence.stdout.join(""));
    expect(await runCli([...activate, "--root", root, "--json"], planned.io)).toBe(0);
    const { planId } = JSON.parse(planned.stdout.join("")) as { planId: string };
    expect(
      await runCli(
        [...activate, "--apply", planId, "--root", root, "--json"],
        io(root, evidence.stdout.join("")).io,
      ),
    ).toBe(0);
    const storage = await openProjectStorage(root);
    try {
      appendRoomEvents(storage, [
        ...mention("dlv_1", logFormat, ciel, "2026-11-27T03:00:00.000Z"),
        ...mention("dlv_2", logFormat, ciel, "2026-11-27T03:05:00.000Z"),
        // In Ciel's own conversation, to another agent, or never delivered: no answer elsewhere.
        ...mention("dlv_3", own, ciel, "2026-11-27T03:06:00.000Z"),
        ...mention("dlv_4", logFormat, arin, "2026-11-27T03:07:00.000Z"),
        ...mention("dlv_5", logFormat, ciel, "2026-11-27T03:08:00.000Z", false),
      ]);
      expect(answersElsewhere(storage, own, ciel)).toEqual([
        {
          mentionId: mentionIdOf("dlv_2"),
          workspaceId: logFormat,
          fromAgentId: iris,
          deliveredAt: "2026-11-27T03:05:00.000Z",
        },
        {
          mentionId: mentionIdOf("dlv_1"),
          workspaceId: logFormat,
          fromAgentId: iris,
          deliveredAt: "2026-11-27T03:00:00.000Z",
        },
      ]);
    } finally {
      await storage.close();
    }
  });
});
