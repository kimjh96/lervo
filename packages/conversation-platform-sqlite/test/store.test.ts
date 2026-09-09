import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

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
  conversations: [
    {
      platform: "slack" as const,
      integrationId,
      tenantKey: "T123",
      conversationKey: "C123",
      projectId: "prj_platform01",
      conversationId: "cnv_platform01",
    },
  ],
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
      actor: {
        kind: "agent" as const,
        participantId: "ptc_platform02",
        roleId: "reviewer",
        agentBinding: {
          agentId: `agt_${"a".repeat(24)}`,
          roleVersion: "1.2.3",
          roleContractHash: `sha256:${"b".repeat(64)}`,
          roleProfileHash: `sha256:${"c".repeat(64)}`,
        },
      },
    },
  ],
});

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("SQLite conversation platform state", () => {
  it("migrates version 1 Slack bindings before accepting extensible platform kinds", async () => {
    const path = await databasePath();
    const legacy = new DatabaseSync(path);
    legacy.exec(`
      CREATE TABLE conversation_bindings (
        platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord')),
        integration_id TEXT NOT NULL, tenant_key TEXT NOT NULL, conversation_key TEXT NOT NULL,
        project_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
        PRIMARY KEY (platform, integration_id, tenant_key, conversation_key),
        UNIQUE (platform, integration_id, project_id, conversation_id)
      ) STRICT;
      CREATE TABLE participant_bindings (
        platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord')),
        integration_id TEXT NOT NULL, tenant_key TEXT NOT NULL, participant_key TEXT NOT NULL,
        actor_kind TEXT NOT NULL CHECK (actor_kind IN ('human', 'agent', 'system')),
        participant_id TEXT NOT NULL, role_id TEXT,
        PRIMARY KEY (platform, integration_id, tenant_key, participant_key),
        CHECK ((actor_kind = 'agent' AND role_id IS NOT NULL)
          OR (actor_kind != 'agent' AND role_id IS NULL))
      ) STRICT;
      CREATE TABLE thread_bindings (
        platform TEXT NOT NULL, integration_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
        conversation_key TEXT NOT NULL, thread_key TEXT NOT NULL, thread_id TEXT NOT NULL,
        PRIMARY KEY (platform, integration_id, tenant_key, conversation_key, thread_key),
        UNIQUE (platform, integration_id, thread_id),
        FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
          REFERENCES conversation_bindings(platform, integration_id, tenant_key, conversation_key)
      ) STRICT;
      CREATE TABLE message_correlations (
        platform TEXT NOT NULL, integration_id TEXT NOT NULL, tenant_key TEXT NOT NULL,
        conversation_key TEXT NOT NULL, external_message_key TEXT NOT NULL,
        reply_event_id TEXT NOT NULL, observed_event_id TEXT, outbound_id TEXT UNIQUE,
        automation_depth INTEGER NOT NULL CHECK (automation_depth BETWEEN 0 AND 8),
        PRIMARY KEY (platform, integration_id, tenant_key, conversation_key, external_message_key),
        FOREIGN KEY (platform, integration_id, tenant_key, conversation_key)
          REFERENCES conversation_bindings(platform, integration_id, tenant_key, conversation_key)
      ) STRICT;
      CREATE TABLE delivery_replay (
        platform TEXT NOT NULL CHECK (platform IN ('slack', 'discord')),
        integration_id TEXT NOT NULL, outbound_id TEXT NOT NULL, request_hash TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('sending', 'unknown', 'rejected', 'delivered')),
        attempted_at TEXT NOT NULL, external_message_key TEXT, delivered_at TEXT,
        PRIMARY KEY (platform, integration_id, outbound_id),
        CHECK ((status = 'delivered' AND external_message_key IS NOT NULL AND delivered_at IS NOT NULL)
          OR (status != 'delivered' AND external_message_key IS NULL AND delivered_at IS NULL))
      ) STRICT;
      CREATE TRIGGER delivery_replay_identity_immutable BEFORE UPDATE ON delivery_replay
        WHEN OLD.platform != NEW.platform OR OLD.integration_id != NEW.integration_id
          OR OLD.outbound_id != NEW.outbound_id OR OLD.request_hash != NEW.request_hash
          OR OLD.status = 'delivered'
        BEGIN SELECT RAISE(ABORT, 'delivery replay identity is immutable'); END;
      INSERT INTO conversation_bindings VALUES (
        'slack', '${integrationId}', 'T123', 'C123', 'prj_platform01', 'cnv_platform01'
      );
      INSERT INTO participant_bindings VALUES (
        'slack', '${integrationId}', 'T123', 'user:U123', 'human', 'ptc_platform01', NULL
      );
      INSERT INTO participant_bindings VALUES (
        'slack', '${integrationId}', 'T123', 'bot:B123', 'agent', 'ptc_platform02', 'reviewer'
      );
      INSERT INTO thread_bindings VALUES (
        'slack', '${integrationId}', 'T123', 'C123', 'legacy-thread',
        'thd_legacy_thread_01'
      );
      INSERT INTO message_correlations VALUES (
        'slack', '${integrationId}', 'T123', 'C123', 'legacy-message-1',
        '${eventId}', NULL, NULL, 2
      );
      INSERT INTO delivery_replay VALUES (
        'slack', '${integrationId}', '${outboundId}', '${requestHash}', 'delivered',
        '2026-08-20T01:59:00.000Z', 'legacy-delivery-1', '2026-08-20T02:00:00.000Z'
      );
      PRAGMA user_version = 1;
    `);
    legacy.close();

    const store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(
      store.mapInbound({
        platform: "slack",
        integrationId,
        tenantKey: "T123",
        conversationKey: "C123",
        threadKey: "legacy-thread",
        sourceMessageKey: "legacy-message-1",
        replyToMessageKey: null,
        participantKey: "user:U123",
        mentionedParticipantKeys: [],
        actorKindHint: "human",
      }),
    ).resolves.toMatchObject({
      projectId: "prj_platform01",
      threadId: "thd_legacy_thread_01",
      automationDepth: 2,
    });
    store.close();
    const migrated = new DatabaseSync(path, { readOnly: true });
    expect(migrated.prepare("PRAGMA user_version").get()?.user_version).toBe(4);
    expect(
      migrated.prepare("SELECT COUNT(*) AS count FROM conversation_bindings").get()?.count,
    ).toBe(1);
    expect(
      migrated.prepare("SELECT COUNT(*) AS count FROM participant_bindings").get()?.count,
    ).toBe(2);
    expect(migrated.prepare("SELECT thread_id FROM thread_bindings").get()?.thread_id).toBe(
      "thd_legacy_thread_01",
    );
    expect(
      migrated.prepare("SELECT automation_depth FROM message_correlations").get()?.automation_depth,
    ).toBe(2);
    expect(
      migrated.prepare("SELECT status, external_message_key FROM delivery_replay").get(),
    ).toEqual({ status: "delivered", external_message_key: "legacy-delivery-1" });
    migrated.close();
  });

  it("persists a registered third-party platform kind without core code changes", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationPlatformStore.open({
      path,
      conversations: [
        {
          platform: "teams",
          integrationId: "itg_platform02",
          tenantKey: "tenant-1",
          conversationKey: "channel-1",
          projectId: "prj_platform01",
          conversationId: "cnv_platform01",
        },
      ],
      participants: [
        {
          platform: "teams",
          integrationId: "itg_platform02",
          tenantKey: "tenant-1",
          participantKey: "user-1",
          actor: { kind: "human", participantId: "ptc_platform01", roleId: null },
        },
      ],
    });

    await expect(
      store.mapInbound({
        platform: "teams",
        integrationId: "itg_platform02",
        tenantKey: "tenant-1",
        conversationKey: "channel-1",
        threadKey: null,
        sourceMessageKey: "message-1",
        replyToMessageKey: null,
        participantKey: "user-1",
        mentionedParticipantKeys: [],
        actorKindHint: "human",
      }),
    ).resolves.toMatchObject({
      projectId: "prj_platform01",
      conversationId: "cnv_platform01",
    });
    store.close();
  });

  it("persists and compare-and-set advances an ingress cursor across restart", async () => {
    const path = await databasePath();
    const discordOptions = {
      path,
      conversations: [
        {
          platform: "discord" as const,
          integrationId,
          tenantKey: "123456789012345678",
          conversationKey: "223456789012345678",
          projectId: "prj_platform01",
          conversationId: "cnv_platform01",
        },
      ],
      participants: [],
    };
    let store = await SQLiteConversationPlatformStore.open(discordOptions);
    const address = {
      platform: "discord" as const,
      integrationId,
      tenantKey: "123456789012345678",
      conversationKey: "223456789012345678",
    };
    await expect(store.readIngressCursor(address)).resolves.toBeNull();
    await store.advanceIngressCursor({
      ...address,
      expectedCursor: null,
      cursor: "323456789012345678",
    });
    store.close();

    store = await SQLiteConversationPlatformStore.open(discordOptions);
    await expect(store.readIngressCursor(address)).resolves.toBe("323456789012345678");
    await expect(
      store.advanceIngressCursor({
        ...address,
        expectedCursor: "different-cursor",
        cursor: "423456789012345678",
      }),
    ).rejects.toMatchObject({ code: "conflicting_binding" });
    await expect(store.readIngressCursor(address)).resolves.toBe("323456789012345678");
    store.close();
  });

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
    await expect(
      store.mapInbound({
        platform: "slack",
        integrationId,
        tenantKey: "T123",
        conversationKey: "C123",
        threadKey: null,
        sourceMessageKey: "agent-message-1",
        replyToMessageKey: null,
        participantKey: "bot:B123",
        mentionedParticipantKeys: [],
        actorKindHint: "agent",
      }),
    ).resolves.toMatchObject({
      actor: {
        kind: "agent",
        participantId: "ptc_platform02",
        roleId: "reviewer",
        agentBinding: {
          agentId: `agt_${"a".repeat(24)}`,
          roleVersion: "1.2.3",
          roleContractHash: `sha256:${"b".repeat(64)}`,
          roleProfileHash: `sha256:${"c".repeat(64)}`,
        },
      },
    });
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
    await expect(
      store.mapOutbound({
        platform: "slack",
        integrationId,
        target: {
          integrationId,
          projectId: "prj_platform01",
          conversationId: "cnv_platform01",
          threadId: first.threadId,
        },
        actor: { kind: "agent", participantId: "ptc_platform02", roleId: "reviewer" },
      }),
    ).resolves.toMatchObject({
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
    await expect(
      store.mapInbound({
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
      }),
    ).rejects.toMatchObject({ code: "mapping_not_found" });
    store.close();
  });

  it("keeps uncertain sends blocked and successful receipts replayable across restart", async () => {
    const path = await databasePath();
    let store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(
      store.begin({
        platform: "slack",
        integrationId,
        outboundId,
        requestHash,
        attemptedAt: "2026-08-20T00:00:00.000Z",
      }),
    ).resolves.toEqual({ status: "reserved" });
    store.close();
    store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(
      store.begin({
        platform: "slack",
        integrationId,
        outboundId,
        requestHash,
        attemptedAt: "2026-08-20T00:00:01.000Z",
      }),
    ).resolves.toEqual({ status: "unknown" });

    const deliveredOutbound = `cvo_${"e".repeat(64)}`;
    await store.begin({
      platform: "slack",
      integrationId,
      outboundId: deliveredOutbound,
      requestHash,
      attemptedAt: "2026-08-20T00:00:02.000Z",
    });
    await store.complete({
      platform: "slack",
      integrationId,
      outboundId: deliveredOutbound,
      requestHash,
      externalMessageKey: "1710000004.000100",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    });
    store.close();
    store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(
      store.begin({
        platform: "slack",
        integrationId,
        outboundId: deliveredOutbound,
        requestHash,
        attemptedAt: "2026-08-20T00:00:04.000Z",
      }),
    ).resolves.toEqual({
      status: "delivered",
      externalMessageKey: "1710000004.000100",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    });
    await expect(
      store.begin({
        platform: "slack",
        integrationId,
        outboundId: deliveredOutbound,
        requestHash: `sha256:${"f".repeat(64)}`,
        attemptedAt: "2026-08-20T00:00:04.000Z",
      }),
    ).resolves.toEqual({ status: "conflict" });
    store.close();
  });

  it("rejects actor and configuration remapping instead of overwriting it", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationPlatformStore.open(options(path));
    await expect(
      store.mapInbound({
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
      }),
    ).rejects.toMatchObject({ code: "conflicting_binding" });
    store.close();
    await expect(
      SQLiteConversationPlatformStore.open({
        ...options(path),
        conversations: [{ ...options(path).conversations[0]!, projectId: "prj_platform02" }],
      }),
    ).rejects.toMatchObject({ code: "conflicting_binding" });
  });

  it("refreshes the current role snapshot for the same hired agent across restart", async () => {
    const path = await databasePath();
    let store = await SQLiteConversationPlatformStore.open(options(path));
    store.close();

    const changed = options(path);
    changed.participants[1] = {
      ...changed.participants[1]!,
      actor: {
        kind: "agent",
        participantId: "ptc_platform02",
        roleId: "ceo",
        agentBinding: {
          agentId: `agt_${"a".repeat(24)}`,
          roleVersion: "2.0.0",
          roleContractHash: `sha256:${"d".repeat(64)}`,
          roleProfileHash: `sha256:${"e".repeat(64)}`,
        },
      },
    };
    store = await SQLiteConversationPlatformStore.open(changed);

    await expect(
      store.mapInbound({
        platform: "slack",
        integrationId,
        tenantKey: "T123",
        conversationKey: "C123",
        threadKey: null,
        sourceMessageKey: "agent-message-after-role-change",
        replyToMessageKey: null,
        participantKey: "bot:B123",
        mentionedParticipantKeys: [],
        actorKindHint: "agent",
      }),
    ).resolves.toMatchObject({
      actor: {
        participantId: "ptc_platform02",
        roleId: "ceo",
        agentBinding: {
          agentId: `agt_${"a".repeat(24)}`,
          roleVersion: "2.0.0",
          roleContractHash: `sha256:${"d".repeat(64)}`,
          roleProfileHash: `sha256:${"e".repeat(64)}`,
        },
      },
    });
    store.close();
  });

  it("rejects assigning an existing platform principal to a different hired agent", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationPlatformStore.open(options(path));
    store.close();
    const changed = options(path);
    changed.participants[1] = {
      ...changed.participants[1]!,
      actor: {
        kind: "agent",
        participantId: "ptc_platform02",
        roleId: "reviewer",
        agentBinding: {
          agentId: `agt_${"f".repeat(24)}`,
          roleVersion: "1.2.3",
          roleContractHash: `sha256:${"b".repeat(64)}`,
          roleProfileHash: `sha256:${"c".repeat(64)}`,
        },
      },
    };
    await expect(SQLiteConversationPlatformStore.open(changed)).rejects.toMatchObject({
      code: "conflicting_binding",
    });
  });
});
