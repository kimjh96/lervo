import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SQLiteConversationPlatformStore } from "../src/index.js";

const roots: string[] = [];
const integrationId = "itg_platform01";
const eventId = `cve_${"a".repeat(64)}`;
const replyEventId = `cve_${"b".repeat(64)}`;
const outboundId = `cvo_${"c".repeat(64)}`;
const requestHash = `sha256:${"d".repeat(64)}`;

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-platform-"));
  roots.push(root);
  return resolve(root, "platform.sqlite");
}

const options = (path: string) => ({
  path,
  conversations: [{
    platform: "slack" as const,
    integrationId,
    tenantKey: "T123",
    conversationKey: "C123",
    projectId: "prj_platform01",
    conversationId: "cnv_platform01",
  }],
  participants: [
    {
      platform: "slack" as const,
      integrationId,
      tenantKey: "T123",
      participantKey: "user:U123",
      actor: { kind: "human" as const, participantId: "ptc_platform01", roleId: null },
    },
    {
      platform: "slack" as const,
      integrationId,
      tenantKey: "T123",
      participantKey: "bot:B123",
      actor: { kind: "agent" as const, participantId: "ptc_platform02", roleId: "reviewer" },
    },
  ],
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLite conversation platform state", () => {
  it("restores thread, reply and automation correlation after restart", async () => {
    const path = await databasePath();
    let store = await SQLiteConversationPlatformStore.open(options(path));
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    const first = await store.mapInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: "1710000000.000100",
      sourceMessageKey: "1710000001.000100",
      replyToMessageKey: null,
      participantKey: "user:U123",
      mentionedParticipantKeys: ["bot:B123", "user:unknown"],
      actorKindHint: "human",
    });
    expect(first).toMatchObject({
      projectId: "prj_platform01",
      conversationId: "cnv_platform01",
      actor: { participantId: "ptc_platform01" },
      mentions: { roleIds: ["reviewer"], participantIds: ["ptc_platform02"] },
      automationDepth: 0,
    });
    expect(first.threadId).toMatch(/^thd_[a-f0-9]{64}$/);
    await store.recordInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      externalMessageKey: "1710000001.000100",
      eventId,
      automationDepth: 0,
    });
    store.close();

    store = await SQLiteConversationPlatformStore.open(options(path));
    const reply = await store.mapInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: "1710000000.000100",
      sourceMessageKey: "1710000002.000100",
      replyToMessageKey: "1710000001.000100",
      participantKey: "user:U123",
      mentionedParticipantKeys: [],
      actorKindHint: "human",
    });
    expect(reply.threadId).toBe(first.threadId);
    expect(reply.replyToEventId).toBe(eventId);
    await expect(store.mapOutbound({
      platform: "slack",
      integrationId,
      target: {
        integrationId,
        projectId: "prj_platform01",
        conversationId: "cnv_platform01",
        threadId: first.threadId,
      },
      actor: { kind: "agent", participantId: "ptc_platform02", roleId: "reviewer" },
    })).resolves.toMatchObject({
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: "1710000000.000100",
    });
    await store.recordOutbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      externalMessageKey: "1710000003.000100",
      outboundId,
      sourceEventId: replyEventId,
      automationDepth: 2,
    });
    const echo = await store.mapInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: "1710000000.000100",
      sourceMessageKey: "1710000003.000100",
      replyToMessageKey: "1710000003.000100",
      participantKey: "bot:B123",
      mentionedParticipantKeys: [],
      actorKindHint: "agent",
    });
    expect(echo).toMatchObject({ automationDepth: 2, replyToEventId: replyEventId });
    store.close();

    store = await SQLiteConversationPlatformStore.open({
      path,
      conversations: [],
      participants: [],
    });
    await expect(store.mapInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: null,
      sourceMessageKey: "1710000005.000100",
      replyToMessageKey: null,
      participantKey: "user:U123",
      mentionedParticipantKeys: [],
      actorKindHint: "human",
    })).rejects.toMatchObject({ code: "mapping_not_found" });
    store.close();
  });

  it("keeps uncertain sends blocked and successful receipts replayable across restart", async () => {
    const path = await databasePath();
    let store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(store.begin({
      platform: "slack", integrationId, outboundId, requestHash,
      attemptedAt: "2026-08-20T00:00:00.000Z",
    })).resolves.toEqual({ status: "reserved" });
    store.close();
    store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(store.begin({
      platform: "slack", integrationId, outboundId, requestHash,
      attemptedAt: "2026-08-20T00:00:01.000Z",
    })).resolves.toEqual({ status: "unknown" });

    const deliveredOutbound = `cvo_${"e".repeat(64)}`;
    await store.begin({
      platform: "slack", integrationId, outboundId: deliveredOutbound, requestHash,
      attemptedAt: "2026-08-20T00:00:02.000Z",
    });
    await store.complete({
      platform: "slack", integrationId, outboundId: deliveredOutbound, requestHash,
      externalMessageKey: "1710000004.000100",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    });
    store.close();
    store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(store.begin({
      platform: "slack", integrationId, outboundId: deliveredOutbound, requestHash,
      attemptedAt: "2026-08-20T00:00:04.000Z",
    })).resolves.toEqual({
      status: "delivered",
      externalMessageKey: "1710000004.000100",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    });
    await expect(store.begin({
      platform: "slack", integrationId, outboundId: deliveredOutbound,
      requestHash: `sha256:${"f".repeat(64)}`,
      attemptedAt: "2026-08-20T00:00:04.000Z",
    })).resolves.toEqual({ status: "conflict" });
    store.close();
  });

  it("rejects actor and configuration remapping instead of overwriting it", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(store.mapInbound({
      platform: "slack",
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      threadKey: null,
      sourceMessageKey: "1710000001.000100",
      replyToMessageKey: null,
      participantKey: "bot:B123",
      mentionedParticipantKeys: [],
      actorKindHint: "human",
    })).rejects.toMatchObject({ code: "conflicting_binding" });
    store.close();
    await expect(SQLiteConversationPlatformStore.open({
      ...options(path),
      conversations: [{ ...options(path).conversations[0]!, projectId: "prj_platform02" }],
    })).rejects.toMatchObject({ code: "conflicting_binding" });
  });
});
