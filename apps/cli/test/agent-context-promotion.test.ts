import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { conversationNoteSubject } from "@lervo/agent-organization";
import { openProjectStorage } from "@lervo/project-storage";
import { afterEach, describe, expect, it } from "vitest";

import { promoteAgentContext, type AgentContextPromotion } from "../src/agent-context-promotion.js";
import { providerSessionDigest } from "../src/hosted-session-events.js";
import { runCli } from "../src/main.js";
import { appendRoomEvents, mentionIdOf } from "../src/room-events.js";

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

/** A project whose writer selects `schemaVersion`, with two hired agents. */
async function project(schemaVersion: number) {
  const root = await realpath(await mkdtemp(resolve(tmpdir(), "lervo-context-note-")));
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

/** Records Elio's mention of Ciel and its delivery, and returns the receipt's ID and hash. */
async function receipt(root: string, ciel: string, elio: string) {
  const storage = await openProjectStorage(root);
  try {
    const mentionId = mentionIdOf("dlv_1");
    const delivered = {
      mentionId,
      providerSessionDigest: providerSessionDigest("claude", "s-ciel"),
      occurredAt: new Date(Date.now() - 60_000).toISOString(),
    };
    appendRoomEvents(storage, [
      {
        type: "room.mention.recorded",
        payload: {
          workspaceId: WORKSPACE,
          mentionId,
          fromAgentId: elio,
          toAgentId: ciel,
          depth: 1,
          occurredAt: delivered.occurredAt,
        },
      },
      { type: "room.mention.delivered", payload: delivered },
    ]);
    const event = storage.events.list().find((item) => item.type === "room.mention.delivered");
    if (event === undefined) throw new Error("no receipt");
    return { eventId: event.eventId, eventHash: event.eventHash };
  } finally {
    await storage.close();
  }
}

const note = (
  ciel: string,
  receiptOf: { eventId: string; eventHash: string },
  topic = "retries",
): AgentContextPromotion => ({
  agentId: ciel,
  layer: "work",
  memoryKind: "conversation_note",
  subjectKey: conversationNoteSubject(WORKSPACE, topic),
  retrievalTerms: ["retries"],
  confidence: "medium",
  sensitivity: "internal",
  source: { kind: "event", sourceId: receiptOf.eventId, contentHash: receiptOf.eventHash },
  reviewEventId: receiptOf.eventId,
  summary: "I committed to retry with a 2 s default and to report the budget.",
  expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
});

describe("promoting a conversation note", () => {
  it("records a note its receipt attests, once per receipt", async () => {
    const { root, ciel, elio } = await project(16);
    const attested = await receipt(root, ciel, elio);
    const context = await promoteAgentContext(root, note(ciel, attested));
    expect(context.entries).toEqual([
      expect.objectContaining({ memoryKind: "conversation_note", confidence: "medium" }),
    ]);
    await expect(promoteAgentContext(root, note(ciel, attested, "budget"))).rejects.toThrow(
      "A delivery's receipt attests one conversation note.",
    );
    // The receipt names Ciel, so it attests no note of Elio's.
    await expect(promoteAgentContext(root, note(elio, attested, "other"))).rejects.toThrow(
      "The review does not attest the exact context summary and agent.",
    );
  });

  it("records no note below event schema 16", async () => {
    const { root, ciel, elio } = await project(15);
    const attested = await receipt(root, ciel, elio);
    await expect(promoteAgentContext(root, note(ciel, attested))).rejects.toThrow(
      "A conversation note needs event schema 16.",
    );
    const storage = await openProjectStorage(root);
    try {
      expect(storage.events.list().some((event) => event.type === "agent.context.promoted")).toBe(
        false,
      );
    } finally {
      await storage.close();
    }
  });
});
