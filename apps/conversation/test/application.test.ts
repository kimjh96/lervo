import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { NativeChatConversationAdapter } from "@lervo/adapter-native-chat";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openConversationApplication } from "../src/index.js";

const roots: string[] = [];
const now = new Date("2026-08-20T02:00:00.000Z");
const secret = "slack-signing-secret-for-application";

function signed(body: Uint8Array) {
  const timestamp = Math.floor(now.getTime() / 1_000);
  return {
    body,
    headers: {
      "x-slack-request-timestamp": String(timestamp),
      "x-slack-signature": `v0=${createHmac("sha256", secret)
        .update(`v0:${timestamp}:`)
        .update(body)
        .digest("hex")}`,
    },
  };
}

function event(input: { id: string; ts: string; threadTs?: string }) {
  return Buffer.from(
    JSON.stringify({
      type: "event_callback",
      api_app_id: "A123",
      team_id: "T123",
      event_id: input.id,
      event: {
        type: "message",
        channel: "C123",
        user: "U123",
        text: "Check the deployment combination.",
        ts: input.ts,
        event_ts: input.ts,
        ...(input.threadTs === undefined ? {} : { thread_ts: input.threadTs }),
      },
    }),
  );
}

function options(dataDirectory: string) {
  return {
    dataDirectory,
    conversations: [
      {
        platform: "slack" as const,
        integrationId: "itg_slack001",
        tenantKey: "T123",
        conversationKey: "C123",
        projectId: "prj_platform01",
        conversationId: "cnv_platform01",
      },
    ],
    participants: [
      {
        platform: "slack" as const,
        integrationId: "itg_slack001",
        tenantKey: "T123",
        participantKey: "user:U123",
        actor: { kind: "human" as const, participantId: "ptc_platform01", roleId: null },
      },
    ],
    slack: [
      {
        integrationId: "itg_slack001",
        apiAppId: "A123",
        allowedTeamIds: ["T123"],
        signingSecret: secret,
        botToken: `xoxb-${"s".repeat(40)}`,
      },
    ],
    now: () => now,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation deployment composition", () => {
  it("registers a canonical native chat adapter without platform-specific app changes", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-native-"));
    roots.push(root);
    const native = new NativeChatConversationAdapter({
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
    expect(application.slackAdapters).toHaveLength(0);
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
    const mismatched = new NativeChatConversationAdapter({
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
    const adapter = application.slackAdapters.get("itg_slack001");
    if (adapter === undefined) throw new Error("Slack adapter missing");
    const first = await adapter.receive(
      signed(
        event({
          id: "Ev-application-1",
          ts: "1787191200.000100",
        }),
      ),
    );
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("first event not accepted");
    application.close();

    application = await openConversationApplication(options(root));
    const restored = application.slackAdapters.get("itg_slack001");
    if (restored === undefined) throw new Error("restored Slack adapter missing");
    const reply = await restored.receive(
      signed(
        event({
          id: "Ev-application-2",
          ts: "1787191201.000100",
          threadTs: "1787191200.000100",
        }),
      ),
    );
    expect(reply.status).toBe("accepted");
    if (reply.status !== "accepted") throw new Error("reply event not accepted");
    expect(reply.event.replyToEventId).toBe(first.event.eventId);
    expect(reply.event.target.threadId).toMatch(/^thd_[a-f0-9]{64}$/);
    application.close();
  });

  it("rejects bindings for an integration that is not deployed", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-scope-"));
    roots.push(root);
    await expect(
      openConversationApplication({
        ...options(root),
        slack: [],
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
    const adapter = application.slackAdapters.get("itg_slack001");
    if (adapter === undefined || application.deliberations === null) {
      throw new Error("Conversation deliberation delivery is missing.");
    }
    const received = await adapter.receive(
      signed(
        event({
          id: "Ev-deliberation-1",
          ts: "1787191200.000200",
        }),
      ),
    );
    if (received.status !== "accepted") throw new Error("The deliberation event was not received.");
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
    await expect(
      application.deliberations.inspect({
        event: received.event,
        deliberationId: first.deliberationId,
        inspectedAt: "2026-08-20T02:03:00.000Z",
      }),
    ).resolves.toMatchObject({ status: "no_consensus", artifactCount: 4 });
    application.close();
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
    const adapter = application.slackAdapters.get("itg_slack001");
    if (
      adapter === undefined ||
      application.deliberations === null ||
      application.reconcileDeliberation === null
    )
      throw new Error("Conversation deliberation reconciliation delivery is missing.");
    const received = await adapter.receive(
      signed(
        event({
          id: "Ev-reconciliation-1",
          ts: "1787191200.000300",
        }),
      ),
    );
    if (received.status !== "accepted") throw new Error("The deliberation event was not received.");
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
    const resumeEvent = await adapter.receive(
      signed(
        event({
          id: "Ev-reconciliation-2",
          ts: "1787191201.000300",
        }),
      ),
    );
    if (resumeEvent.status !== "accepted") throw new Error("The resume event was not received.");
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
