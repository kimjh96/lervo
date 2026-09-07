import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import { createConversationParticipationPolicy } from "@lervo/conversation-contract";
import {
  ConversationRemoteContinuationResponder,
  type ConversationRemoteContinuationPort,
} from "@lervo/conversation-control";
import { VerifiedConversationPublication } from "@lervo/conversation-responder";
import { defaultEnglishWritingContract } from "@lervo/core";
import type {
  DiscordGatewayConnectionObserver,
  DiscordGatewayTransport,
} from "@lervo/discord-gateway";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openConversationApplication } from "../src/index.js";

const roots: string[] = [];
const now = new Date("2026-09-07T09:00:00.000Z");
const integrationId = "itg_discord01";
const applicationId = "999999999999999999";
const guildId = "123456789012345678";
const channelId = "223456789012345678";
const humanId = "323456789012345678";

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function evaluator(): WritingSemanticEvaluator {
  return {
    async evaluate(request) {
      return {
        evaluator: { kind: "model", evaluatorId: "fixture.discord-remote-writing.v1" },
        checks: request.checks.map((check) => ({
          checkId: check.checkId,
          status: "passed" as const,
          violationCount: 0,
        })),
      };
    },
  };
}

function gatewayMessage(messageId: string): Uint8Array {
  return Buffer.from(
    JSON.stringify({
      op: 0,
      s: 42,
      t: "MESSAGE_CREATE",
      d: {
        id: messageId,
        channel_id: channelId,
        guild_id: guildId,
        author: { id: humanId, bot: false },
        content: "Continue the current assignment and run its required verification.",
        mentions: [{ id: applicationId }],
        timestamp: "2026-09-07T08:59:00.000Z",
      },
    }),
  );
}

class GatewayTransport implements DiscordGatewayTransport {
  observer: DiscordGatewayConnectionObserver | null = null;
  readonly sent: string[] = [];

  connect(_url: string, observer: DiscordGatewayConnectionObserver) {
    this.observer = observer;
    return {
      send: (payload: string) => this.sent.push(payload),
      close: () => undefined,
    };
  }

  emit(payload: Uint8Array | object): void {
    if (this.observer === null) throw new Error("Discord Gateway is not connected.");
    this.observer.message(payload instanceof Uint8Array ? payload : JSON.stringify(payload));
  }
}

async function settled(until?: () => boolean): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    if (until?.()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
}

describe("Discord remote continuation application journey", () => {
  it("authenticates, queues, replies, and deduplicates one remote continuation message", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-discord-remote-app-"));
    roots.push(root);
    const artifacts = await FileSystemCas.open(resolve(root, "artifacts"));
    const request = vi.fn<ConversationRemoteContinuationPort["request"]>(async () => ({
      status: "queued",
      deliveryId: `rcd_${"a".repeat(64)}`,
      provider: "codex",
      roleId: "developer",
      workstreamId: `wks_${"b".repeat(24)}`,
      workstreamRevision: 12,
    }));
    const policy = createConversationParticipationPolicy({
      projectId: "prj_remote001",
      roleId: "developer",
      conversationIds: ["cnv_remote001"],
      mode: "mention_only",
      respondTo: ["human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 8,
      maxAutomationDepth: 2,
      createdAt: "2026-09-07T08:00:00.000Z",
    });
    const responder = new ConversationRemoteContinuationResponder({
      artifactStore: artifacts,
      continuation: { request },
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: evaluator(),
      now: () => now,
    });
    const publicationVerifier = new VerifiedConversationPublication({
      artifactStore: artifacts,
      resolveWritingContract: async () => defaultEnglishWritingContract,
    });
    const fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { content: string; allowed_mentions: unknown };
      expect(body.content).toContain("queueing only");
      expect(body.allowed_mentions).toEqual({ parse: [], replied_user: false });
      return new Response(JSON.stringify({ id: "423456789012345678", channel_id: channelId }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    const gateway = new GatewayTransport();
    const gatewayErrors: Error[] = [];
    const application = await openConversationApplication({
      dataDirectory: root,
      conversations: [
        {
          platform: "discord",
          integrationId,
          tenantKey: guildId,
          conversationKey: channelId,
          projectId: "prj_remote001",
          conversationId: "cnv_remote001",
        },
      ],
      participants: [
        {
          platform: "discord",
          integrationId,
          tenantKey: guildId,
          participantKey: `user:${humanId}`,
          actor: { kind: "human", participantId: "ptc_operator01", roleId: null },
        },
        {
          platform: "discord",
          integrationId,
          tenantKey: guildId,
          participantKey: `user:${applicationId}`,
          actor: { kind: "agent", participantId: "ptc_lervoagent", roleId: "developer" },
        },
      ],
      discord: [
        {
          integrationId,
          applicationId,
          allowedGuildIds: [guildId],
          allowDirectMessages: false,
          botToken: `discord.${"t".repeat(40)}`,
          gateway: {
            intents: 37_377,
            transport: gateway,
            reconnectDelayMs: 100,
            onError: (error) => gatewayErrors.push(error),
          },
        },
      ],
      interactions: {
        bindings: [
          {
            policy,
            agentParticipantId: "ptc_lervoagent",
            responder,
            publicationVerifier,
          },
        ],
        workerId: "discord-remote-worker",
        now: () => now,
      },
      now: () => now,
      fetch,
    });
    if (
      !application.discordAdapters.has(integrationId) ||
      !application.discordGateways.has(integrationId)
    ) {
      throw new Error("Discord remote continuation composition is incomplete.");
    }
    gateway.emit({ op: 10, d: { heartbeat_interval: 45_000 } });
    gateway.emit({
      op: 0,
      s: 41,
      t: "READY",
      d: { session_id: "discord-app-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    gateway.emit(gatewayMessage("523456789012345678"));
    await settled(() => request.mock.calls.length === 1 && fetch.mock.calls.length === 1);

    expect(gatewayErrors).toEqual([]);
    expect(JSON.parse(gateway.sent[0]!)).toMatchObject({ op: 2, d: { intents: 37_377 } });
    expect(request).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();

    gateway.emit(gatewayMessage("523456789012345678"));
    await settled();
    expect(request).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
    application.close();
  });
});
