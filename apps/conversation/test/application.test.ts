import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { calculateConversationDeliberationOriginBindingDigest } from "@lervo/conversation-control";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openConversationApplication, type ConversationApplication } from "../src/index.js";
import { TestConversationAdapter } from "../../../packages/conversation-contract/test/conversation-adapter.fixture.js";

const roots: string[] = [];
const now = new Date("2026-08-20T02:00:00.000Z");
const integrationId = "itg_discord01";
const applicationId = "999999999999999999";
const guildId = "123456789012345678";
const channelId = "223456789012345678";
const humanId = "323456789012345678";
let sequence = 0;

function dispatch(input: { messageId: string; replyToMessageId?: string }) {
  sequence += 1;
  return {
    sessionHandle: "discord-session-application",
    body: Buffer.from(
      JSON.stringify({
        op: 0,
        s: sequence,
        t: "MESSAGE_CREATE",
        d: {
          id: input.messageId,
          channel_id: channelId,
          guild_id: guildId,
          author: { id: humanId, bot: false },
          content: "Check the deployment combination.",
          mentions: [],
          timestamp: now.toISOString(),
          ...(input.replyToMessageId === undefined
            ? {}
            : {
                message_reference: { message_id: input.replyToMessageId },
                referenced_message: { author: { id: humanId, bot: false } },
              }),
        },
      }),
    ),
  };
}

async function receive(
  application: ConversationApplication,
  input: { messageId: string; replyToMessageId?: string },
) {
  const adapter = application.discordAdapters.get(integrationId);
  if (adapter === undefined) throw new Error("Discord adapter missing");
  const received = await adapter.receiveGatewayDispatch(dispatch(input));
  if (received.status !== "accepted") throw new Error("The Discord message was not accepted.");
  return received;
}

function options(dataDirectory: string) {
  return {
    dataDirectory,
    conversations: [
      {
        platform: "discord" as const,
        integrationId,
        tenantKey: guildId,
        conversationKey: channelId,
        projectId: "prj_platform01",
        conversationId: "cnv_platform01",
      },
    ],
    participants: [
      {
        platform: "discord" as const,
        integrationId,
        tenantKey: guildId,
        participantKey: `user:${humanId}`,
        actor: { kind: "human" as const, participantId: "ptc_platform01", roleId: null },
      },
    ],
    discord: [
      {
        integrationId,
        applicationId,
        allowedGuildIds: [guildId],
        allowDirectMessages: false,
        botToken: `discord.${"t".repeat(40)}`,
        gatewayAuthentication: {
          verifyDispatch: async () => ({ authenticated: true as const }),
        },
      },
    ],
    now: () => now,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation deployment composition", () => {
  it("registers a platform-neutral adapter without platform-specific app changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-native-"));
    roots.push(root);
    const native = new TestConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "internal-chat-production",
      delivery: {
        send: async () => ({
          deliveryKey: "native-message-1",
          deliveredAt: "2026-08-20T02:00:01.000Z",
        }),
      },
    });
    const application = await openConversationApplication({
      dataDirectory: root,
      conversations: [],
      participants: [],
      integrations: [
        {
          integrationId: "itg_native001",
          platform: null,
          create: () => native,
        },
      ],
    });

    expect(application.adapters.get("itg_native001")).toBe(native);
    expect(application.discordAdapters).toHaveLength(0);
    expect(
      native.normalizeInbound({
        sourceEventKey: "native-event-1",
        target: {
          projectId: "prj_platform01",
          conversationId: "cnv_platform01",
          threadId: null,
        },
        kind: "message.created",
        actor: { kind: "human", participantId: "ptc_platform01", roleId: null },
        content: {
          artifactId: "art_native_message_01",
          contentHash: `sha256:${"a".repeat(64)}`,
          byteCount: 12,
          mediaType: "text/plain; charset=utf-8",
        },
        occurredAt: now.toISOString(),
      }).target.integrationId,
    ).toBe("itg_native001");
    application.close();
  });

  it("rejects an external adapter whose kind differs from its platform binding", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-kind-"));
    roots.push(root);
    const mismatched = new TestConversationAdapter({
      integrationId: "itg_teams001",
      instanceIdentity: "wrong-adapter-kind",
      delivery: {
        send: async () => ({
          deliveryKey: "unused",
          deliveredAt: "2026-08-20T02:00:01.000Z",
        }),
      },
    });
    await expect(
      openConversationApplication({
        dataDirectory: root,
        conversations: [
          {
            platform: "teams",
            integrationId: "itg_teams001",
            tenantKey: "tenant-1",
            conversationKey: "channel-1",
            projectId: "prj_platform01",
            conversationId: "cnv_platform01",
          },
        ],
        participants: [
          {
            platform: "teams",
            integrationId: "itg_teams001",
            tenantKey: "tenant-1",
            participantKey: "user-1",
            actor: { kind: "human", participantId: "ptc_platform01", roleId: null },
          },
        ],
        integrations: [
          {
            integrationId: "itg_teams001",
            platform: "teams",
            create: () => mismatched,
          },
        ],
      }),
    ).rejects.toThrow("deployment coordinates");
  });

  it("restores a platform reply link through the application entrypoint", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-"));
    roots.push(root);
    let application = await openConversationApplication(options(root));
    const first = await receive(application, { messageId: "423456789012345678" });
    await application.close();

    application = await openConversationApplication(options(root));
    const reply = await receive(application, {
      messageId: "423456789012345679",
      replyToMessageId: "423456789012345678",
    });
    expect(reply.event.replyToEventId).toBe(first.event.eventId);
    expect(reply.event.target.threadId).toBeNull();
    await application.close();
  });

  it("rejects bindings for an integration that is not deployed", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-scope-"));
    roots.push(root);
    await expect(
      openConversationApplication({
        ...options(root),
        discord: [],
      }),
    ).rejects.toThrow("integration");
  });

  it("rejects a resume permission without a resume executor", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-resume-config-"));
    roots.push(root);
    await expect(
      openConversationApplication({
        ...options(root),
        deliberations: {
          bindings: [
            {
              projectId: "prj_platform01",
              participantId: "ptc_platform01",
              principalId: "operator:reviewer",
              permissions: ["deliberation.resume"] as const,
            },
          ],
          executor: {
            execute: async () => {
              throw new Error("Must not be called.");
            },
          },
          workerId: "conversation-worker-1",
        },
      }),
    ).rejects.toThrow("resume executor");
  });

  it("keeps a deliberation command durable across application restarts", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-deliberation-"));
    roots.push(root);
    const execute = vi.fn(async (job: { deliberationId: string }) => ({
      deliberationId: job.deliberationId,
      status: "no_consensus" as const,
      artifactCount: 4,
      nextAction: "none" as const,
    }));
    const configured = {
      ...options(root),
      deliberations: {
        bindings: [
          {
            projectId: "prj_platform01",
            participantId: "ptc_platform01",
            principalId: "operator:reviewer",
            permissions: ["deliberation.start", "deliberation.read"] as const,
          },
        ],
        executor: { execute },
        workerId: "conversation-worker-1",
      },
    };
    let application = await openConversationApplication(configured);
    if (application.deliberations === null) {
      throw new Error("Conversation deliberation delivery is missing.");
    }
    const received = await receive(application, { messageId: "423456789012345680" });
    const first = await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
      requestedAt: "2026-08-20T02:00:00.000Z",
    });
    application.close();

    application = await openConversationApplication(configured);
    if (application.deliberations === null)
      throw new Error("Deliberation control was not restored.");
    await expect(
      application.inspectDeliberationOrigin({
        projectId: "prj_platform01",
        deliberationId: first.deliberationId,
      }),
    ).resolves.toEqual({
      sourceEventId: received.event.eventId,
      conversationId: "cnv_platform01",
      threadId: null,
      requesterParticipantId: "ptc_platform01",
      responseLanguage: "en",
      originBindingDigest: calculateConversationDeliberationOriginBindingDigest({
        projectId: "prj_platform01",
        sourceEventId: received.event.eventId,
        conversationId: "cnv_platform01",
        threadId: null,
        requesterParticipantId: "ptc_platform01",
      }),
    });
    const duplicate = await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
      requestedAt: "2026-08-20T02:00:01.000Z",
    });
    expect(duplicate.deliberationId).toBe(first.deliberationId);
    await expect(application.runDeliberationWorkerCycle()).resolves.toMatchObject({
      status: "settled",
      deliberationId: first.deliberationId,
    });
    expect(execute).toHaveBeenCalledOnce();
    const notification = await application.claimDeliberationNotification();
    expect(notification).toMatchObject({
      notification: {
        operation: "start",
        deliberationId: first.deliberationId,
        summary: { status: "no_consensus", artifactCount: 4 },
        occurredAt: "2026-08-20T02:00:00.000Z",
        state: "leased",
      },
      origin: {
        sourceEventId: received.event.eventId,
        conversationId: "cnv_platform01",
        requesterParticipantId: "ptc_platform01",
      },
    });
    if (notification === null) throw new Error("The terminal notification was not claimed.");
    await application.acceptDeliberationNotification({
      operation: notification.notification.operation,
      deliberationId: notification.notification.deliberationId,
      leaseId: notification.leaseId,
      conversationEventId: `cve_${"b".repeat(64)}`,
    });
    await expect(application.claimDeliberationNotification()).resolves.toBeNull();
    await expect(
      application.deliberations.inspect({
        event: received.event,
        deliberationId: first.deliberationId,
        inspectedAt: "2026-08-20T02:03:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "no_consensus", artifactCount: 4 });
    application.close();
  });

  it("keeps stores open until an admitted deliberation worker finishes during shutdown", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-drain-"));
    roots.push(root);
    let release!: () => void;
    let started!: () => void;
    const workGate = new Promise<void>((resolve) => (release = resolve));
    const workStarted = new Promise<void>((resolve) => (started = resolve));
    const application = await openConversationApplication({
      ...options(root),
      deliberations: {
        bindings: [
          {
            projectId: "prj_platform01",
            participantId: "ptc_platform01",
            principalId: "operator:reviewer",
            permissions: ["deliberation.start"] as const,
          },
        ],
        executor: {
          execute: async (job) => {
            started();
            await workGate;
            return {
              deliberationId: job.deliberationId,
              status: "no_consensus" as const,
              artifactCount: 0,
              nextAction: "none" as const,
            };
          },
        },
        workerId: "conversation-worker-1",
      },
    });
    if (application.deliberations === null) {
      throw new Error("The deliberation deployment is unavailable.");
    }
    const received = await receive(application, { messageId: "423456789012345681" });
    await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "Review the upgrade boundary.",
      requestedAt: now.toISOString(),
    });

    const active = application.runDeliberationWorkerCycle();
    await workStarted;
    let closed = false;
    const closing = application.close().then(() => (closed = true));
    await expect(application.runDeliberationWorkerCycle()).rejects.toThrow("admission is closed");
    expect(closed).toBe(false);
    release();
    await expect(active).resolves.toMatchObject({ status: "settled" });
    await closing;
    expect(closed).toBe(true);
  });

  it("reconciles an interruption and runs its durable resume queue", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-reconcile-"));
    roots.push(root);
    const inspect = vi.fn(async (input: { job: { deliberationId: string } }) => ({
      status: "confirmed" as const,
      sourceKind: "managed_deliberation_inspection_v1" as const,
      evidenceHash: `sha256:${"e".repeat(64)}`,
      summary: {
        deliberationId: input.job.deliberationId,
        status: "interrupted" as const,
        artifactCount: 3,
        nextAction: "resume" as const,
      },
    }));
    const application = await openConversationApplication({
      ...options(root),
      deliberations: {
        bindings: [
          {
            projectId: "prj_platform01",
            participantId: "ptc_platform01",
            principalId: "operator:reviewer",
            permissions: [
              "deliberation.start",
              "deliberation.resume",
              "deliberation.read",
            ] as const,
          },
        ],
        executor: {
          execute: async () => {
            throw new Error("The result is unknown.");
          },
        },
        resumeExecutor: {
          execute: async (job) => ({
            deliberationId: job.deliberationId,
            status: "converged",
            artifactCount: 5,
            nextAction: "none",
          }),
        },
        reconciliationSource: { inspect },
        workerId: "conversation-worker-1",
      },
    });
    if (application.deliberations === null || application.reconcileDeliberation === null)
      throw new Error("Conversation deliberation reconciliation delivery is missing.");
    const received = await receive(application, { messageId: "423456789012345682" });
    const started = await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "Reconcile an uncertain execution result with its sources.",
      requestedAt: now.toISOString(),
    });
    await expect(application.runDeliberationWorkerCycle()).resolves.toMatchObject({
      status: "uncertain",
      deliberationId: started.deliberationId,
    });
    await expect(
      application.reconcileDeliberation({
        projectId: "prj_platform01",
        deliberationId: started.deliberationId,
      }),
    ).resolves.toMatchObject({
      status: "reconciled",
      summary: { status: "interrupted", artifactCount: 3 },
    });
    expect(inspect).toHaveBeenCalledOnce();
    await expect(
      application.deliberations.inspect({
        event: received.event,
        deliberationId: started.deliberationId,
        inspectedAt: now.toISOString(),
      }),
    ).resolves.toMatchObject({ status: "interrupted", artifactCount: 3 });
    const resumeEvent = await receive(application, { messageId: "423456789012345683" });
    await expect(
      application.deliberations.resume({
        event: resumeEvent.event,
        deliberationId: started.deliberationId,
        requestedAt: now.toISOString(),
      }),
    ).resolves.toMatchObject({ status: "running", nextAction: "wait" });
    await expect(application.runDeliberationResumeWorkerCycle()).resolves.toMatchObject({
      status: "settled",
      deliberationId: started.deliberationId,
      summary: { status: "converged", artifactCount: 5 },
    });
    await expect(
      application.deliberations.inspect({
        event: resumeEvent.event,
        deliberationId: started.deliberationId,
        inspectedAt: now.toISOString(),
      }),
    ).resolves.toMatchObject({ status: "converged", artifactCount: 5 });
    application.close();
  });
});
