import { resolve } from "node:path";

import { registerAgent } from "@lervo/agent-workforce";
import type {
  DiscordGatewayConnectionObserver,
  DiscordGatewayTransport,
} from "@lervo/discord-gateway";
import { afterEach, describe, expect, it } from "vitest";

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

  connect(_url: string, observer: DiscordGatewayConnectionObserver) {
    this.observer = observer;
    return { send: () => undefined, close: () => undefined };
  }

  emit(payload: unknown): void {
    if (this.observer === null) throw new Error("Gateway is not connected.");
    this.observer.message(JSON.stringify(payload));
  }
}

async function health(repositoryRoot: string) {
  const source = await import("node:fs/promises").then(({ readFile }) =>
    readFile(resolve(repositoryRoot, ".lervo/state/node-runtime-health.json"), "utf8"),
  );
  return readNodeRuntimeHealthSnapshot(JSON.parse(source));
}

async function settled(until: () => Promise<boolean>): Promise<void> {
  for (let index = 0; index < 1_000; index += 1) {
    if (await until()) return;
    await new Promise<void>((resolvePromise) => setTimeout(resolvePromise, 1));
  }
  throw new Error("The multi-bot Discord runtime did not settle.");
}

describe("multi-bot Discord conversation deployment", () => {
  it("requires every Gateway for readiness and fails the Node when any bot fails", async () => {
    const root = await temporaryRoot();
    const fixture = await nodeRuntimeFixture(root, await availablePort());
    const firstAgent = await registerAgent({
      repositoryRoot: fixture.repositoryRoot,
      roleId: "developer",
      provider: "codex",
      responsibilityPaths: ["."],
      recordEvent: () => undefined,
    });
    const secondAgent = await registerAgent({
      repositoryRoot: fixture.repositoryRoot,
      roleId: "researcher",
      provider: "claude",
      responsibilityPaths: ["."],
      recordEvent: () => undefined,
    });
    await ownerFile(resolve(root, "discord-01.token"), `discord.${"a".repeat(40)}\n`);
    await ownerFile(resolve(root, "discord-02.token"), `discord.${"b".repeat(40)}\n`);
    const conversation = (input: {
      suffix: string;
      applicationId: string;
      participantId: string;
      agentId: string;
      provider: "codex" | "claude";
    }) => ({
      integrationId: `itg_discord${input.suffix}`,
      applicationId: input.applicationId,
      botTokenFile: `discord-${input.suffix}.token`,
      intents: 37_377,
      allowedGuildIds: [guildId],
      allowDirectMessages: false,
      workerId: `discord-${input.suffix}`,
      agentParticipantId: input.participantId,
      agentId: input.agentId,
      conversations: [
        { tenantKey: guildId, conversationKey: channelId, conversationId: "cnv_operator01" },
      ],
      participants: [{ tenantKey: guildId, userId: humanId, participantId: "ptc_operator01" }],
      command: {
        roleId: "developer",
        provider: input.provider,
        risk: "medium",
        verificationSuiteIds: ["repo.check"],
        lifetimeMs: 120_000,
      },
    });
    const configured = structuredClone(fixture.value) as typeof fixture.value & {
      discordConversations: unknown[];
    };
    configured.discordConversations = [
      conversation({
        suffix: "01",
        applicationId: "999999999999999991",
        participantId: "ptc_lervoagent01",
        agentId: firstAgent.agentId,
        provider: "codex",
      }),
      conversation({
        suffix: "02",
        applicationId: "999999999999999992",
        participantId: "ptc_lervoagent02",
        agentId: secondAgent.agentId,
        provider: "claude",
      }),
    ];
    await ownerFile(fixture.configPath, JSON.stringify(configured));
    const firstGateway = new GatewayTransport();
    const secondGateway = new GatewayTransport();
    const deployment = await openNodeRuntime(await loadNodeRuntimeConfig(fixture.configPath), {
      createTransport: () => ({
        registerProject: async () => ({}),
        sendEventBatch: async () => ({}),
      }),
      discordConversations: {
        itg_discord01: {
          gatewayTransport: firstGateway,
          fetch: async () =>
            new Response("[]", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        },
        itg_discord02: {
          gatewayTransport: secondGateway,
          fetch: async () =>
            new Response("[]", {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        },
      },
    });
    deployments.push(deployment);

    firstGateway.emit({ op: 10, d: { heartbeat_interval: 45_000 } });
    firstGateway.emit({
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "first-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    await expect(health(fixture.repositoryRoot)).resolves.toMatchObject({
      conversation: { status: "pending" },
    });

    secondGateway.emit({ op: 10, d: { heartbeat_interval: 45_000 } });
    secondGateway.emit({
      op: 0,
      s: 1,
      t: "READY",
      d: { session_id: "second-session", resume_gateway_url: "wss://gateway.discord.gg" },
    });
    await settled(
      async () => (await health(fixture.repositoryRoot)).conversation?.status === "ready",
    );
    await expect(health(fixture.repositoryRoot)).resolves.toMatchObject({
      conversation: { status: "ready" },
    });

    await deployment.start();
    firstGateway.observer!.close(4004, "authentication rejected");
    await expect(deployment.closed).resolves.toMatchObject({
      status: "failed",
      failureCode: "conversation_runtime_failed",
    });
  });
});
