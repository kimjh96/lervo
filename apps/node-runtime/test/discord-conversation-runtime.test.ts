import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import type { ConversationRemoteContinuationPort } from "@lervo/conversation-control";
import { createVerifiedConversationControlReply } from "@lervo/conversation-control";
import { realtimeConversationWritingContract } from "@lervo/core";
import type {
  DiscordGatewayConnectionObserver,
  DiscordGatewayTransport,
} from "@lervo/discord-gateway";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  loadNodeRuntimeConfig,
  openNodeRuntime,
  readNodeRuntimeHealthSnapshot,
  type NodeRuntimeDeployment,
} from "../src/index.js";
import {
  availablePort,
  nodeRuntimeFixture,
  ownerFile,
  removeTemporaryRoots,
  temporaryRoot,
} from "./fixture.js";

const applicationId = "999999999999999999";
const guildId = "123456789012345678";
const channelId = "223456789012345678";
const humanId = "323456789012345678";
const deployments: NodeRuntimeDeployment[] = [];

afterEach(async () => {
  await Promise.all(deployments.splice(0).map((deployment) => deployment.close()));
  await removeTemporaryRoots();
});

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

  emit(payload: unknown): void {
    if (this.observer === null) throw new Error("Gateway is not connected.");
    this.observer.message(JSON.stringify(payload));
  }
}

async function settled(until: () => boolean): Promise<void> {
  for (let index = 0; index < 1_000; index += 1) {
    if (until()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  throw new Error("The Discord runtime did not settle.");
}

describe("installed Node Discord conversation runtime", () => {
  it("loads owner-only credentials, reaches ready, queues a request, and fails closed", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    await ownerFile(resolve(root, "discord.token"), `discord.${"t".repeat(40)}\n`);
    const configured = structuredClone(fixture.value);
    configured.discordConversation = {
      integrationId: "itg_discord01",
      applicationId,
      botTokenFile: "discord.token",
      intents: 37_377,
      allowedGuildIds: [guildId],
      allowDirectMessages: false,
      workerId: "discord-operator",
      agentParticipantId: "ptc_lervoagent",
      conversations: [
        { tenantKey: guildId, conversationKey: channelId, conversationId: "cnv_operator01" },
      ],
      participants: [{ tenantKey: guildId, userId: humanId, participantId: "ptc_operator01" }],
      administration: { allowedActions: ["current_member.nickname.set"] },
      routing: {
        readOnlyRoleId: "conversation-reader",
        intent: { provider: "codex" },
        response: { provider: "codex" },
      },
      command: {
        roleId: "developer",
        provider: "codex",
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        lifetimeMs: 120_000,
      },
    };
    await ownerFile(fixture.configPath, JSON.stringify(configured));
    const request = vi.fn<ConversationRemoteContinuationPort["request"]>(async () => ({
      status: "queued",
      deliveryId: `rcd_${"a".repeat(64)}`,
      commandId: `rcm_${"c".repeat(64)}`,
      provider: "codex",
      roleId: "developer",
      workstreamId: `wks_${"b".repeat(24)}`,
      workstreamRevision: 9,
      workstreamSnapshotContentHash: `sha256:${"d".repeat(64)}`,
      assignmentId: null,
      agentId: null,
      queuedAt: "2026-09-07T08:00:00.000Z",
    }));
    const messageDelivery = vi.fn(
      async (_url: string | URL | Request, _init?: RequestInit) =>
        new Response(JSON.stringify({ id: "423456789012345678", channel_id: channelId }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const typingDelivery = vi.fn(async () => new Response(null, { status: 204 }));
    const administrationDelivery = vi.fn(
      async () =>
        new Response(JSON.stringify({ nick: "Lervo", user: { id: applicationId } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const delivery = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === "GET") {
        return new Response("[]", {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (String(url).endsWith("/members/@me")) return administrationDelivery();
      return String(url).endsWith("/typing") ? typingDelivery() : messageDelivery(url, init);
    });
    const gateway = new GatewayTransport();
    const gatewayErrors: Error[] = [];
    const intentResolver = vi.fn(async ({ message, priorTurns }) => ({
      intent: message.startsWith("What") ? ("answer" as const) : ("continue_work" as const),
      confidence: "high" as const,
      participation: "relevant" as const,
      effect: message.startsWith("What")
        ? ({ kind: "none" } as const)
        : message.startsWith("Change")
          ? ({ kind: "discord_current_member_nickname_set", nickname: "Lervo" } as const)
          : ({ kind: "repository_work" } as const),
      provider: { providerId: "codex", model: null, adapterVersion: "2" as const },
      resultDigest: `sha256:${createHash("sha256")
        .update(JSON.stringify({ message, priorTurns }))
        .digest("hex")}`,
    }));
    const readOnlyResponse = vi.fn(async () => {
      const artifacts = await FileSystemCas.open(
        resolve(fixture.repositoryRoot, ".lervo/data/conversation/itg_discord01/artifacts"),
      );
      return createVerifiedConversationControlReply({
        artifactStore: artifacts,
        writingContract: realtimeConversationWritingContract,
        content: "The current workstream is active and the repository was not changed.",
      });
    });
    const deployment = await openNodeRuntime(await loadNodeRuntimeConfig(fixture.configPath), {
      createTransport: () => ({
        registerProject: async () => ({}),
        sendEventBatch: async () => ({}),
      }),
      discordConversation: {
        continuation: { request },
        readOnlyResponder: { respond: readOnlyResponse },
        intentResolver: {
          resolve: intentResolver,
        },
        gatewayTransport: gateway,
        fetch: delivery as typeof globalThis.fetch,
        onError: (error) => gatewayErrors.push(error),
      },
    });
    deployments.push(deployment);
    gateway.emit({ op: 10, d: { heartbeat_interval: 45_000 } });
    gateway.emit({
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "node-discord-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    gateway.emit({
      op: 0,
      s: 2,
      t: "MESSAGE_CREATE",
      d: {
        id: "523456789012345678",
        channel_id: channelId,
        guild_id: guildId,
        author: { id: humanId, bot: false },
        content: "Continue the current workstream.",
        mentions: [],
        timestamp: "2026-09-07T08:00:00.000Z",
      },
    });
    try {
      await settled(
        () => request.mock.calls.length === 1 && messageDelivery.mock.calls.length === 1,
      );
    } catch {
      throw new Error(
        `Discord first intent=${intentResolver.mock.calls.length} response=${readOnlyResponse.mock.calls.length} request=${request.mock.calls.length} delivery=${delivery.mock.calls.length} errors=${gatewayErrors
          .map(
            (error) =>
              `${error.message}:${error.cause instanceof Error ? error.cause.message : "no cause"}`,
          )
          .join("|")}`,
      );
    }
    gateway.emit({
      op: 0,
      s: 3,
      t: "MESSAGE_CREATE",
      d: {
        id: "623456789012345678",
        channel_id: channelId,
        guild_id: guildId,
        author: { id: humanId, bot: false },
        content: `<@${applicationId}> What is the current workstream?`,
        mentions: [{ id: applicationId }],
        timestamp: "2026-09-07T08:00:01.000Z",
      },
    });
    try {
      await settled(
        () =>
          request.mock.calls.length === 1 &&
          readOnlyResponse.mock.calls.length === 1 &&
          messageDelivery.mock.calls.length === 2,
      );
    } catch {
      const health = await readFile(
        resolve(fixture.repositoryRoot, ".lervo/state/node-runtime-health.json"),
        "utf8",
      );
      throw new Error(
        `Discord request=${request.mock.calls.length} delivery=${delivery.mock.calls.length} errors=${gatewayErrors
          .map(
            (error) =>
              `${error.message}:${error.cause instanceof Error ? error.cause.message : "no cause"}`,
          )
          .join("|")} health=${health}`,
      );
    }
    gateway.emit({
      op: 0,
      s: 4,
      t: "MESSAGE_CREATE",
      d: {
        id: "723456789012345678",
        channel_id: channelId,
        guild_id: guildId,
        author: { id: humanId, bot: false },
        content: "Change your server nickname to Lervo.",
        mentions: [],
        timestamp: "2026-09-07T08:00:02.000Z",
      },
    });
    await settled(
      () =>
        administrationDelivery.mock.calls.length === 1 && messageDelivery.mock.calls.length === 3,
    );
    expect(request).toHaveBeenCalledOnce();
    expect(readOnlyResponse).toHaveBeenCalledOnce();
    expect(messageDelivery).toHaveBeenCalledTimes(3);
    expect(administrationDelivery).toHaveBeenCalledOnce();
    expect(typingDelivery).toHaveBeenCalledTimes(3);
    expect(intentResolver.mock.calls[0]![0]).toMatchObject({ mentioned: false, priorTurns: [] });
    expect(intentResolver.mock.calls[1]![0].priorTurns).toHaveLength(2);
    expect(intentResolver.mock.calls[2]![0]).toMatchObject({
      mentioned: false,
      availableEffects: expect.arrayContaining(["discord_current_member_nickname_set"]),
    });
    expect(JSON.parse(gateway.sent[0]!)).toMatchObject({ op: 2, d: { intents: 37_377 } });
    expect(
      await readFile(
        resolve(fixture.repositoryRoot, ".lervo/state/node-runtime-health.json"),
        "utf8",
      )
        .then(JSON.parse)
        .then(readNodeRuntimeHealthSnapshot),
    ).toMatchObject({
      conversation: { status: "ready" },
    });

    await deployment.start();
    gateway.observer!.close(4004, "authentication rejected");
    await expect(deployment.closed).resolves.toMatchObject({
      status: "failed",
      failureCode: "conversation_runtime_failed",
    });
  });
});
