import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { DiscordConversationAdapter, type DiscordDeliveryRequest } from "@lervo/adapter-discord";
import { SlackConversationAdapter, type SlackDeliveryRequest } from "@lervo/adapter-slack";
import { FileSystemCas } from "@lervo/cas";
import {
  createConversationOutboundMessage,
  createConversationParticipationPolicy,
} from "@lervo/conversation-contract";
import type {
  ConversationInboundEvent,
  ConversationOutboundMessage,
  WritingPublicationPermit,
} from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ConversationPlatformIdentityPort, storeConversationText } from "../src/index.js";

const roots: string[] = [];
const now = new Date("2026-08-20T00:00:00Z");

async function artifacts() {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-platform-adapter-"));
  roots.push(root);
  return FileSystemCas.open(root);
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function identityPort() {
  const inbound = vi.fn(
    async (input: Parameters<ConversationPlatformIdentityPort["mapInbound"]>[0]) => ({
      projectId: "prj_platform_adapter",
      conversationId: "cnv_team_general",
      threadId: input.threadKey === null ? null : "thd_platform_thread",
      actor:
        input.actorKindHint === "agent"
          ? { kind: "agent" as const, participantId: "ptc_external_bot", roleId: "external_bot" }
          : { kind: "human" as const, participantId: "ptc_external_user", roleId: null },
      mentions: {
        roleIds: input.mentionedParticipantKeys.length > 0 ? ["reviewer"] : [],
        participantIds: input.mentionedParticipantKeys.length > 0 ? ["ptc_lervo_agent"] : [],
      },
      replyToEventId: null,
      automationDepth: input.actorKindHint === "agent" ? 2 : 0,
    }),
  );
  const outbound = vi.fn(
    async (input: Parameters<ConversationPlatformIdentityPort["mapOutbound"]>[0]) =>
      input.platform === "slack"
        ? {
            tenantKey: "T123",
            conversationKey: "C123",
            threadKey: "1710000000.000100",
            replyToMessageKey: "1710000000.000100",
          }
        : {
            tenantKey: "123456789012345678",
            conversationKey: "223456789012345678",
            threadKey: null,
            replyToMessageKey: "323456789012345678",
          },
  );
  const recordInbound = vi.fn(async () => undefined);
  const record = vi.fn(async () => undefined);
  return {
    port: { mapInbound: inbound, mapOutbound: outbound, recordInbound, recordOutbound: record },
    inbound,
    outbound,
    recordInbound,
    record,
  };
}

function permit(
  content: Awaited<ReturnType<typeof storeConversationText>>,
): WritingPublicationPermit {
  const value: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface: "chat",
    artifactId: content.artifactId,
    contentHash: content.contentHash,
    writingPolicyId: "writing_en-human",
    writingPolicyHash: `sha256:${"c".repeat(64)}`,
    evaluationId: "wre_platform_reply",
    evaluationHash: `sha256:${"d".repeat(64)}`,
    issuedAt: "2026-08-20T00:00:01.000Z",
  };
  return { ...value, permitId: calculateWritingPublicationPermitId(value) };
}

async function outbound(input: {
  event: ConversationInboundEvent;
  artifactStore: Awaited<ReturnType<typeof artifacts>>;
}): Promise<ConversationOutboundMessage> {
  const content = await storeConversationText({
    content: "Confirmed. Proceeding to the next verification step.",
    artifactStore: input.artifactStore,
  });
  const policy = createConversationParticipationPolicy({
    projectId: input.event.target.projectId,
    roleId: "reviewer",
    conversationIds: [input.event.target.conversationId],
    mode: "relevant",
    respondTo: ["human"],
    signalCodes: [],
    cooldownSeconds: 0,
    maxResponsesPerHour: 5,
    maxAutomationDepth: 3,
    createdAt: "2026-08-19T23:59:00.000Z",
  });
  return createConversationOutboundMessage({
    event: input.event,
    policy,
    participantId: "ptc_lervo_agent",
    content,
    publicationPermit: permit(content),
    createdAt: "2026-08-20T00:00:02.000Z",
  });
}

function slackRequest(body: Uint8Array, timestamp: number, secret: string) {
  const signature = `v0=${createHmac("sha256", secret)
    .update(`v0:${timestamp}:`)
    .update(body)
    .digest("hex")}`;
  return {
    headers: {
      "X-Slack-Request-Timestamp": String(timestamp),
      "x-slack-signature": signature,
    },
    body,
  };
}

describe("authenticated platform conversation adapters", () => {
  it("authenticates, scopes and normalizes Slack events before storing message content", async () => {
    const artifactStore = await artifacts();
    const identity = identityPort();
    const send = vi.fn(async (_request: SlackDeliveryRequest) => ({
      messageTs: "1710000001.000200",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    }));
    const secret = "slack-signing-secret-for-fixture";
    const adapter = new SlackConversationAdapter({
      integrationId: "itg_slack001",
      apiAppId: "A123",
      allowedTeamIds: ["T123"],
      signingSecret: secret,
      identity: identity.port,
      artifactStore,
      delivery: { send },
      now: () => now,
    });
    const timestamp = Math.floor(now.getTime() / 1_000);
    const rawText = "Please review the deployment risk <@U999>";
    const body = Buffer.from(
      JSON.stringify({
        type: "event_callback",
        api_app_id: "A123",
        team_id: "T123",
        event_id: "Ev-private-1",
        event_time: timestamp,
        event: {
          type: "message",
          channel: "C123",
          user: "U123",
          text: rawText,
          ts: `${timestamp}.000001`,
          event_ts: `${timestamp}.000001`,
        },
      }),
    );

    const accepted = await adapter.receive(slackRequest(body, timestamp, secret));
    expect(accepted.status).toBe("accepted");
    if (accepted.status !== "accepted") throw new Error("Slack fixture must be accepted");
    expect(accepted.event).toMatchObject({
      actor: { kind: "human", participantId: "ptc_external_user" },
      mentions: { roleIds: ["reviewer"], participantIds: ["ptc_lervo_agent"] },
      automationDepth: 0,
    });
    expect(JSON.stringify(accepted.event)).not.toContain("Ev-private-1");
    expect(JSON.stringify(accepted.event)).not.toContain("U123");
    expect(
      Buffer.from(
        await artifactStore.get(
          `lervo-cas://sha256/${accepted.event.content.contentHash.slice(7)}`,
        ),
      ).toString("utf8"),
    ).toBe(rawText);
    expect(identity.inbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "T123",
        participantKey: "user:U123",
        mentionedParticipantKeys: ["user:U999"],
      }),
    );
    expect(identity.recordInbound).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "T123",
        conversationKey: "C123",
        externalMessageKey: `${timestamp}.000001`,
        eventId: accepted.event.eventId,
      }),
    );

    const replay = await adapter.receive(slackRequest(body, timestamp, secret));
    expect(replay).toMatchObject({
      status: "accepted",
      event: { eventId: accepted.event.eventId },
    });
    const message = await outbound({ event: accepted.event, artifactStore });
    const receipt = await adapter.deliver(message);
    const retryReceipt = await adapter.deliver(message);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        outboundId: message.outboundId,
        text: "Confirmed. Proceeding to the next verification step.",
        format: "plain",
      }),
    );
    expect(identity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantKey: "T123",
        conversationKey: "C123",
        sourceEventId: message.sourceEventId,
        externalMessageKey: "1710000001.000200",
        automationDepth: 1,
      }),
    );
    expect(receipt).toMatchObject({
      outboundId: message.outboundId,
      integrationId: "itg_slack001",
    });
    expect(retryReceipt.deliveryKeyHash).toBe(receipt.deliveryKeyHash);
    expect(send.mock.calls.map(([request]) => request.outboundId)).toEqual([
      message.outboundId,
      message.outboundId,
    ]);
  });

  it("rejects stale or invalid Slack signatures before identity mapping", async () => {
    const artifactStore = await artifacts();
    const identity = identityPort();
    const adapter = new SlackConversationAdapter({
      integrationId: "itg_slack001",
      apiAppId: "A123",
      allowedTeamIds: ["T123"],
      signingSecret: "slack-signing-secret-for-fixture",
      identity: identity.port,
      artifactStore,
      delivery: { send: async () => ({ messageTs: "1.1", deliveredAt: now.toISOString() }) },
      now: () => now,
    });
    expect(
      () =>
        new SlackConversationAdapter({
          integrationId: "itg_slack002",
          apiAppId: "A123",
          allowedTeamIds: ["T123"],
          signingSecret: "slack-signing-secret-for-fixture",
          identity: identity.port,
          artifactStore,
          delivery: { send: async () => ({ messageTs: "1.1", deliveredAt: now.toISOString() }) },
          capabilities: ["message_revisions"],
        }),
    ).toThrow(expect.objectContaining({ code: "invalid_platform_configuration" }));
    const body = Buffer.from('{"type":"event_callback"}');
    const challengeBody = Buffer.from(
      JSON.stringify({
        type: "url_verification",
        challenge: "challenge-value",
      }),
    );
    const current = Math.floor(now.getTime() / 1_000);
    await expect(
      adapter.receive(slackRequest(challengeBody, current, "slack-signing-secret-for-fixture")),
    ).resolves.toEqual({ status: "challenge", challenge: "challenge-value" });
    const wrongTeamBody = Buffer.from(
      JSON.stringify({
        type: "event_callback",
        api_app_id: "A123",
        team_id: "T999",
        event_id: "Ev-wrong-team",
        event: {
          type: "message",
          channel: "C123",
          user: "U123",
          text: "reject",
          ts: `${current}.1`,
        },
      }),
    );
    await expect(
      adapter.receive(slackRequest(wrongTeamBody, current, "slack-signing-secret-for-fixture")),
    ).rejects.toMatchObject({ code: "platform_authentication_failed" });
    const stale = Math.floor(now.getTime() / 1_000) - 301;
    await expect(
      adapter.receive(slackRequest(body, stale, "slack-signing-secret-for-fixture")),
    ).rejects.toMatchObject({ code: "platform_authentication_failed" });
    await expect(
      adapter.receive(slackRequest(body, current, "different-signing-secret-fixture")),
    ).rejects.toMatchObject({ code: "platform_authentication_failed" });
    expect(identity.inbound).not.toHaveBeenCalled();
  });

  it("requires an authenticated Discord Gateway session and keeps resumed messages idempotent", async () => {
    const artifactStore = await artifacts();
    const identity = identityPort();
    const verifyDispatch = vi.fn(async ({ sessionHandle }: { sessionHandle: string }) =>
      sessionHandle === "authenticated-session"
        ? { authenticated: true as const }
        : { authenticated: false as const, reasonCode: "unknown_session" },
    );
    const send = vi.fn(async (_request: DiscordDeliveryRequest) => ({
      messageId: "423456789012345678",
      deliveredAt: "2026-08-20T00:00:03.000Z",
    }));
    const stopTyping = vi.fn();
    const startTyping = vi.fn(() => ({ stop: stopTyping }));
    const adapter = new DiscordConversationAdapter({
      integrationId: "itg_discord01",
      applicationId: "999999999999999999",
      allowedGuildIds: ["123456789012345678"],
      allowDirectMessages: false,
      gatewayAuthentication: { verifyDispatch },
      identity: identity.port,
      artifactStore,
      delivery: { send },
      typing: { start: startTyping },
      now: () => now,
    });
    const rawText = "Tell me the next step for this change.";
    const body = Buffer.from(
      JSON.stringify({
        op: 0,
        s: 42,
        t: "MESSAGE_CREATE",
        d: {
          id: "323456789012345678",
          channel_id: "223456789012345678",
          guild_id: "123456789012345678",
          author: { id: "523456789012345678", bot: false },
          content: rawText,
          mentions: [{ id: "623456789012345678" }],
          timestamp: "2026-08-20T00:00:00.000Z",
        },
      }),
    );

    await expect(
      adapter.receiveGatewayDispatch({
        sessionHandle: "unknown-session",
        body,
      }),
    ).rejects.toMatchObject({ code: "platform_authentication_failed" });
    expect(identity.inbound).not.toHaveBeenCalled();

    const accepted = await adapter.receiveGatewayDispatch({
      sessionHandle: "authenticated-session",
      body,
    });
    expect(accepted.status).toBe("accepted");
    if (accepted.status !== "accepted") throw new Error("Discord fixture must be accepted");
    const typingLease = accepted.responseActivity?.start();
    expect(startTyping).toHaveBeenCalledWith({ channelId: "223456789012345678" });
    typingLease?.stop();
    expect(stopTyping).toHaveBeenCalledOnce();
    expect(adapter.descriptor.capabilities).toContain("typing");
    const replay = await adapter.receiveGatewayDispatch({
      sessionHandle: "authenticated-session",
      body,
    });
    expect(replay).toMatchObject({
      status: "accepted",
      event: { eventId: accepted.event.eventId },
    });
    expect(verifyDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "999999999999999999",
        sequence: 42,
        eventName: "MESSAGE_CREATE",
      }),
    );
    expect(JSON.stringify(accepted.event)).not.toContain("523456789012345678");
    expect(
      Buffer.from(
        await artifactStore.get(
          `lervo-cas://sha256/${accepted.event.content.contentHash.slice(7)}`,
        ),
      ).toString("utf8"),
    ).toBe(rawText);

    const message = await outbound({ event: accepted.event, artifactStore });
    const receipt = await adapter.deliver(message);
    const retryReceipt = await adapter.deliver(message);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        content: "Confirmed. Proceeding to the next verification step.",
        allowedMentions: "none",
        enforceIdempotency: true,
      }),
    );
    expect(identity.record).toHaveBeenCalledWith(
      expect.objectContaining({
        externalMessageKey: "423456789012345678",
        automationDepth: 1,
      }),
    );
    expect(receipt).toMatchObject({
      outboundId: message.outboundId,
      integrationId: "itg_discord01",
    });
    expect(retryReceipt.deliveryKeyHash).toBe(receipt.deliveryKeyHash);
    expect(send.mock.calls.map(([request]) => request.outboundId)).toEqual([
      message.outboundId,
      message.outboundId,
    ]);
  });

  it("authenticates Discord before rejecting a guild outside the configured scope", async () => {
    const artifactStore = await artifacts();
    const identity = identityPort();
    const verifyDispatch = vi.fn(async () => ({ authenticated: true as const }));
    const adapter = new DiscordConversationAdapter({
      integrationId: "itg_discord01",
      applicationId: "999999999999999999",
      allowedGuildIds: ["123456789012345678"],
      allowDirectMessages: false,
      gatewayAuthentication: { verifyDispatch },
      identity: identity.port,
      artifactStore,
      delivery: { send: async () => ({ messageId: "1", deliveredAt: now.toISOString() }) },
      now: () => now,
    });
    const body = Buffer.from(
      JSON.stringify({
        op: 0,
        s: 43,
        t: "MESSAGE_CREATE",
        d: {
          id: "323456789012345678",
          channel_id: "223456789012345678",
          guild_id: "777777777777777777",
          author: { id: "523456789012345678", bot: false },
          content: "out-of-scope message",
          timestamp: "2026-08-20T00:00:00.000Z",
        },
      }),
    );
    await expect(
      adapter.receiveGatewayDispatch({
        sessionHandle: "authenticated-session",
        body,
      }),
    ).rejects.toMatchObject({ code: "platform_authentication_failed" });
    expect(verifyDispatch).toHaveBeenCalledOnce();
    expect(identity.inbound).not.toHaveBeenCalled();
  });
});
