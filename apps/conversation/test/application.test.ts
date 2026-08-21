import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

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
        .update(`v0:${timestamp}:`).update(body).digest("hex")}`,
    },
  };
}

function event(input: { id: string; ts: string; threadTs?: string }) {
  return Buffer.from(JSON.stringify({
    type: "event_callback",
    api_app_id: "A123",
    team_id: "T123",
    event_id: input.id,
    event: {
      type: "message",
      channel: "C123",
      user: "U123",
      text: "배포 조합을 확인합니다.",
      ts: input.ts,
      event_ts: input.ts,
      ...(input.threadTs === undefined ? {} : { thread_ts: input.threadTs }),
    },
  }));
}

function options(dataDirectory: string) {
  return {
    dataDirectory,
    conversations: [{
      platform: "slack" as const,
      integrationId: "itg_slack001",
      tenantKey: "T123",
      conversationKey: "C123",
      projectId: "prj_platform01",
      conversationId: "cnv_platform01",
    }],
    participants: [{
      platform: "slack" as const,
      integrationId: "itg_slack001",
      tenantKey: "T123",
      participantKey: "user:U123",
      actor: { kind: "human" as const, participantId: "ptc_platform01", roleId: null },
    }],
    slack: [{
      integrationId: "itg_slack001",
      apiAppId: "A123",
      allowedTeamIds: ["T123"],
      signingSecret: secret,
      botToken: `xoxb-${"s".repeat(40)}`,
    }],
    now: () => now,
  };
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("conversation deployment composition", () => {
  it("restores a platform reply link through the application entrypoint", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-"));
    roots.push(root);
    let application = await openConversationApplication(options(root));
    const adapter = application.slackAdapters.get("itg_slack001");
    if (adapter === undefined) throw new Error("Slack adapter missing");
    const first = await adapter.receive(signed(event({
      id: "Ev-application-1",
      ts: "1787191200.000100",
    })));
    expect(first.status).toBe("accepted");
    if (first.status !== "accepted") throw new Error("first event not accepted");
    application.close();

    application = await openConversationApplication(options(root));
    const restored = application.slackAdapters.get("itg_slack001");
    if (restored === undefined) throw new Error("restored Slack adapter missing");
    const reply = await restored.receive(signed(event({
      id: "Ev-application-2",
      ts: "1787191201.000100",
      threadTs: "1787191200.000100",
    })));
    expect(reply.status).toBe("accepted");
    if (reply.status !== "accepted") throw new Error("reply event not accepted");
    expect(reply.event.replyToEventId).toBe(first.event.eventId);
    expect(reply.event.target.threadId).toMatch(/^thd_[a-f0-9]{64}$/);
    application.close();
  });

  it("rejects bindings for an integration that is not deployed", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-app-scope-"));
    roots.push(root);
    await expect(openConversationApplication({
      ...options(root),
      slack: [],
    })).rejects.toThrow("integration");
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
        bindings: [{
          projectId: "prj_platform01",
          participantId: "ptc_platform01",
          principalId: "operator:reviewer",
          permissions: ["deliberation.start", "deliberation.read"] as const,
        }],
        executor: { execute },
        workerId: "conversation-worker-1",
      },
    };
    let application = await openConversationApplication(configured);
    const adapter = application.slackAdapters.get("itg_slack001");
    if (adapter === undefined || application.deliberations === null) {
      throw new Error("Conversation 숙의 배포가 누락되었습니다.");
    }
    const received = await adapter.receive(signed(event({
      id: "Ev-deliberation-1",
      ts: "1787191200.000200",
    })));
    if (received.status !== "accepted") throw new Error("숙의 event가 수신되지 않았습니다.");
    const first = await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "배포 구조를 검토합니다.",
      requestedAt: "2026-08-20T02:00:00.000Z",
    });
    application.close();

    application = await openConversationApplication(configured);
    if (application.deliberations === null) throw new Error("숙의 control이 복원되지 않았습니다.");
    const duplicate = await application.deliberations.start({
      event: received.event,
      policyId: "deliberation_product-review",
      topic: "배포 구조를 검토합니다.",
      requestedAt: "2026-08-20T02:00:01.000Z",
    });
    expect(duplicate.deliberationId).toBe(first.deliberationId);
    await expect(application.runDeliberationWorkerCycle()).resolves.toMatchObject({
      status: "settled",
      deliberationId: first.deliberationId,
    });
    expect(execute).toHaveBeenCalledOnce();
    await expect(application.deliberations.inspect({
      event: received.event,
      deliberationId: first.deliberationId,
      inspectedAt: "2026-08-20T02:03:00.000Z",
    })).resolves.toMatchObject({ status: "no_consensus", artifactCount: 4 });
    application.close();
  });
});
