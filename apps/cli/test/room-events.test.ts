import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { HostedDecodedEvent } from "@lervo/adapter-contract";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { providerSessionDigest } from "../src/hosted-session-events.js";
import { runCli } from "../src/main.js";
import type { ConversationNote } from "../src/conversation-notes.js";
import { mentionIdOf, recordRoomEvents, roomEventId, type RoomEvent } from "../src/room-events.js";
import { RoomRouter, type RoomContext } from "../src/room-router.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const WORKSPACE = `wsp_${"a".repeat(24)}`;
const AGENT = {
  elio: `agt_${"1".repeat(24)}`,
  ciel: `agt_${"2".repeat(24)}`,
  arin: `agt_${"3".repeat(24)}`,
};
const team = [
  { agentId: AGENT.elio, displayName: "Elio", roleName: "Product Owner" },
  { agentId: AGENT.ciel, displayName: "Ciel", roleName: "Developer" },
  { agentId: AGENT.arin, displayName: "Arin", roleName: "Researcher" },
];

function context(
  agentId: string,
  sessions: Record<string, string>,
  repositoryRoot: string | null = "/repo",
): RoomContext {
  return {
    workspaceId: WORKSPACE,
    projectId: "prj_1",
    ...(repositoryRoot === null ? {} : { repositoryRoot }),
    provider: "claude",
    agentId,
    team,
    sessions: new Map(Object.entries(sessions)),
  };
}

function said(text: string): HostedDecodedEvent[] {
  return [
    { kind: "start", content: { kind: "agent_message", text: "" }, createdAtMs: 1 },
    { kind: "delta", text },
    { kind: "finish" },
    { kind: "status", event: "turn_finished" },
  ];
}

const delivered = (text: string): HostedDecodedEvent[] => [
  { kind: "item", content: { kind: "user_message", text }, createdAtMs: 1 },
];

describe("the room's records", () => {
  it("records each mention, its delivery, and a newcomer's joining, by identifiers only", () => {
    let id = 0;
    const recorded: [string, RoomEvent][] = [];
    const room = new RoomRouter(
      () => Date.parse("2026-11-27T03:00:00Z"),
      () => `dlv_${++id}`,
      (root, events) =>
        recorded.push(...events.map((event) => [root, event] as [string, RoomEvent])),
    );
    const sessions = { [AGENT.elio]: "s-elio", [AGENT.ciel]: "s-ciel" };
    room.know("s-elio", context(AGENT.elio, sessions));
    room.know("s-ciel", context(AGENT.ciel, sessions));

    const elio = room.observe("s-elio", said("@Ciel please implement retries."));
    room.sent("s-ciel", "dlv_1", delivered(elio.deliveries[0]?.text ?? ""));
    // Ciel asks Arin, who has no session here yet and joins on the delivery.
    const ciel = room.observe("s-ciel", said("@Arin is Retry-After in seconds?"));
    room.sent("s-arin", "dlv_2", delivered(ciel.deliveries[0]?.text ?? ""));

    const at = "2026-11-27T03:00:00.000Z";
    expect(recorded).toEqual([
      [
        "/repo",
        {
          type: "room.mention.recorded",
          payload: {
            workspaceId: WORKSPACE,
            mentionId: mentionIdOf("dlv_1"),
            fromAgentId: AGENT.elio,
            toAgentId: AGENT.ciel,
            depth: 1,
            occurredAt: at,
          },
        },
      ],
      [
        "/repo",
        {
          type: "room.mention.delivered",
          payload: {
            mentionId: mentionIdOf("dlv_1"),
            providerSessionDigest: providerSessionDigest("claude", "s-ciel"),
            occurredAt: at,
          },
        },
      ],
      [
        "/repo",
        expect.objectContaining({
          type: "room.mention.recorded",
          payload: expect.objectContaining({ fromAgentId: AGENT.ciel, toAgentId: AGENT.arin }),
        }),
      ],
      [
        "/repo",
        {
          type: "room.participant.joined",
          payload: {
            workspaceId: WORKSPACE,
            agentId: AGENT.arin,
            providerSessionDigest: providerSessionDigest("claude", "s-arin"),
            mentionedBy: AGENT.ciel,
            occurredAt: at,
          },
        },
      ],
      [
        "/repo",
        expect.objectContaining({
          type: "room.mention.delivered",
          payload: expect.objectContaining({ mentionId: mentionIdOf("dlv_2") }),
        }),
      ],
    ]);
    expect(JSON.stringify(recorded)).not.toContain("Retry-After");
  });

  it("hands one note per delivered turn, with its receipt, and none for an owner's turn", () => {
    let id = 0;
    const notes: ConversationNote[] = [];
    const room = new RoomRouter(
      () => Date.parse("2026-11-27T03:00:00Z"),
      () => `dlv_${++id}`,
      () => undefined,
      (note) => notes.push(note),
    );
    const sessions = { [AGENT.elio]: "s-elio", [AGENT.ciel]: "s-ciel" };
    room.know("s-elio", context(AGENT.elio, sessions));
    room.know("s-ciel", context(AGENT.ciel, sessions));
    // The owner's own turn to Elio has no receipt, so Elio writes no note.
    room.sent("s-elio", undefined, delivered("Implement retries."));
    const elio = room.observe("s-elio", said("@Ciel please implement retries."));
    expect(notes).toEqual([]);
    room.sent("s-ciel", "dlv_1", delivered(elio.deliveries[0]?.text ?? ""));
    room.observe("s-ciel", said("Done: retries with a 2 s default."));
    expect(notes).toEqual([
      {
        repositoryRoot: "/repo",
        agentId: AGENT.ciel,
        workspaceId: WORKSPACE,
        mentionId: mentionIdOf("dlv_1"),
        receiptEventId: roomEventId({
          type: "room.mention.delivered",
          payload: {
            mentionId: mentionIdOf("dlv_1"),
            providerSessionDigest: providerSessionDigest("claude", "s-ciel"),
            occurredAt: "2026-11-27T03:00:00.000Z",
          },
        }),
        text: "Done: retries with a 2 s default.",
      },
    ]);
    // The next turn of the same session, without a delivery, writes no second note.
    room.sent("s-ciel", undefined, delivered("Thanks."));
    room.observe("s-ciel", said("You are welcome."));
    expect(notes).toHaveLength(1);
  });

  it("records nothing for a conversation whose repository the core did not resolve", () => {
    const recorded: RoomEvent[] = [];
    const room = new RoomRouter(undefined, undefined, (_root, events) => recorded.push(...events));
    const sessions = { [AGENT.elio]: "s-elio", [AGENT.ciel]: "s-ciel" };
    room.know("s-elio", context(AGENT.elio, sessions, null));
    room.observe("s-elio", said("@Ciel please implement retries."));
    expect(recorded).toEqual([]);
  });

  it("keeps the records at schema 15 and later, once each, and nothing below it", async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-room-events-")));
    roots.push(root);
    const io = (stdin = "") => {
      const stdout: string[] = [];
      return {
        stdout,
        io: {
          cwd: root,
          stdout: (message: string) => stdout.push(message),
          stderr: () => undefined,
          stdin: async () => stdin,
        },
      };
    };
    expect(await runCli(["init", "--root", root, "--name", "rooms"], io().io)).toBe(0);
    const events: RoomEvent[] = [
      {
        type: "room.mention.recorded",
        payload: {
          workspaceId: WORKSPACE,
          mentionId: mentionIdOf("dlv_1"),
          fromAgentId: AGENT.elio,
          toAgentId: AGENT.ciel,
          depth: 1,
          occurredAt: "2026-11-27T03:00:00.000Z",
        },
      },
    ];
    expect(await recordRoomEvents(root, events)).toBe("inactive");

    const evidence = io();
    expect(await runCli(["event-contract", "evidence", "--root", root], evidence.io)).toBe(0);
    const activate = ["event-contract", "activate", "--stdin", "--schema-version", "15"];
    const planned = io(evidence.stdout.join(""));
    expect(await runCli([...activate, "--root", root, "--json"], planned.io)).toBe(0);
    const { planId } = JSON.parse(planned.stdout.join("")) as { planId: string };
    const applied = io(evidence.stdout.join(""));
    expect(
      await runCli([...activate, "--apply", planId, "--root", root, "--json"], applied.io),
    ).toBe(0);

    expect(await recordRoomEvents(root, events)).toBe("recorded");
    expect(await recordRoomEvents(root, events)).toBe("recorded");
    const storage = await openProjectStorage(root);
    try {
      // A mention's record under any other ID is refused, so attestation always finds it.
      expect(() =>
        storage.events.append({
          eventId: "evt_mention_elsewhere",
          projectId: storage.manifest.projectId,
          runId: "run_room_test",
          sessionId: "ses_room_test",
          type: "room.mention.recorded",
          schemaVersion: 15,
          occurredAt: "2026-11-27T03:00:00.000Z",
          actor: { kind: "system" },
          policyVersion: `sha256:${"a".repeat(64)}`,
          payload: { ...events[0]!.payload },
        } as never),
      ).toThrowError(expect.objectContaining({ code: "invalid_event" }));
      const kept = storage.events.list().filter((event) => event.type.startsWith("room."));
      expect(kept).toEqual([
        expect.objectContaining({ type: "room.mention.recorded", schemaVersion: 15 }),
      ]);
    } finally {
      await storage.close();
    }
  });
});
