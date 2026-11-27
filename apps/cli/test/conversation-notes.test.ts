import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { contextProjection } from "../src/agent-context-promotion.js";
import { NOTE_CHARACTERS } from "../src/conversation-note-text.js";
import { noteSummary, writeConversationNote } from "../src/conversation-notes.js";
import { learnedEntries } from "../src/core-link-agent-context.js";
import { recalledNotes } from "../src/room-context.js";
import { providerSessionDigest } from "../src/hosted-session-events.js";
import { runCli } from "../src/main.js";
import { appendRoomEvents, mentionIdOf, roomEventId, type RoomEvent } from "../src/room-events.js";
import { listAgents } from "@lervo/agent-workforce";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const WORKSPACE = `wsp_${"e".repeat(24)}`;

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

async function project(schemaVersion: number) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-conversation-note-")));
  roots.push(root);
  expect(await runCli(["init", "--root", root, "--name", "notes"], io(root).io)).toBe(0);
  const evidence = io(root);
  expect(await runCli(["event-contract", "evidence", "--root", root], evidence.io)).toBe(0);
  const activate = [
    "event-contract",
    "activate",
    "--stdin",
    "--schema-version",
    String(schemaVersion),
  ];
  const planned = io(root, evidence.stdout.join(""));
  expect(await runCli([...activate, "--root", root, "--json"], planned.io)).toBe(0);
  const { planId } = JSON.parse(planned.stdout.join("")) as { planId: string };
  expect(
    await runCli(
      [...activate, "--apply", planId, "--root", root, "--json"],
      io(root, evidence.stdout.join("")).io,
    ),
  ).toBe(0);
  const hire = async () => {
    const hired = io(root);
    expect(
      await runCli(["agent", "hire", "--role", "developer", "--write", "--json"], hired.io),
    ).toBe(0);
    return (JSON.parse(hired.stdout.join("")) as { agentId: string }).agentId;
  };
  return { root, ciel: await hire(), elio: await hire() };
}

/** Elio's mention of Ciel and its delivery, as the room records them. */
function receiptEvents(ciel: string, elio: string): [RoomEvent, RoomEvent] {
  const mentionId = mentionIdOf("dlv_1");
  const occurredAt = new Date(Date.now() - 60_000).toISOString();
  return [
    {
      type: "room.mention.recorded",
      payload: {
        workspaceId: WORKSPACE,
        mentionId,
        fromAgentId: elio,
        toAgentId: ciel,
        depth: 1,
        occurredAt,
      },
    },
    {
      type: "room.mention.delivered",
      payload: {
        mentionId,
        providerSessionDigest: providerSessionDigest("claude", "s-ciel"),
        occurredAt,
      },
    },
  ];
}

describe("an agent's conversation note", () => {
  it("keeps the message whole when it fits, and cuts a long one at a word", () => {
    expect(noteSummary("  Done:\n retries  with a 2 s default. ")).toBe(
      "Done: retries with a 2 s default.",
    );
    const long = `${"word ".repeat(200)}end`;
    const cut = noteSummary(long);
    expect(cut.length).toBeLessThanOrEqual(NOTE_CHARACTERS);
    expect(cut.endsWith("word…")).toBe(true);
  });

  it("keeps only the agent's own words, never code or the words it quotes", () => {
    const message = [
      "> Elio: please use a 5 s retry default.",
      "I chose a 2 s default instead.",
      "```ts",
      "const retry = { budget: 5 };",
      "```",
      "~~~~",
      "```",
      "still code",
      "~~~~",
      "The budget stays at 5 attempts.",
    ].join("\n");
    expect(noteSummary(message)).toBe(
      "I chose a 2 s default instead. The budget stays at 5 attempts.",
    );
    expect(noteSummary("```\nonly code\n```\n> and a quote")).toBe("");
  });

  it("records the agent's note its receipt attests, at schema 16", async () => {
    const { root, ciel, elio } = await project(16);
    const events = receiptEvents(ciel, elio);
    const storage = await openProjectStorage(root);
    try {
      appendRoomEvents(storage, events);
    } finally {
      await storage.close();
    }
    const note = {
      repositoryRoot: root,
      agentId: ciel,
      workspaceId: WORKSPACE,
      mentionId: mentionIdOf("dlv_1"),
      receiptEventId: roomEventId(events[1]),
      text: "Done: retries with a 2 s default.",
    };
    expect(await writeConversationNote({ ...note, text: "```\nonly code\n```" })).toBe("empty");
    expect(await writeConversationNote(note)).toBe("recorded");
    // The same receipt attests no second note.
    expect(await writeConversationNote(note)).toBe("unavailable");
    // Ciel's next session recalls it; Elio's profile and recall never see it.
    expect(recalledNotes(await learnedEntries(root, ciel))).toEqual([
      "- Done: retries with a 2 s default.",
    ]);
    expect(await learnedEntries(root, elio)).toEqual([]);
    const reread = await openProjectStorage(root);
    try {
      const context = contextProjection(reread, await listAgents(root), ciel);
      expect(context.entries).toEqual([
        expect.objectContaining({ memoryKind: "conversation_note", layer: "work" }),
      ]);
    } finally {
      await reread.close();
    }
  });

  it("records nothing below schema 16, or without its receipt", async () => {
    const { root, ciel } = await project(15);
    const note = {
      repositoryRoot: root,
      agentId: ciel,
      workspaceId: WORKSPACE,
      mentionId: mentionIdOf("dlv_1"),
      receiptEventId: "evt_missingreceipt",
      text: "Done.",
    };
    expect(await writeConversationNote(note)).toBe("inactive");
    const current = await project(16);
    expect(
      await writeConversationNote({ ...note, repositoryRoot: current.root, agentId: current.ciel }),
    ).toBe("unavailable");
  });
});
