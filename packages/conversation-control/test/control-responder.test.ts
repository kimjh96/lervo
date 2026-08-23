import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import { FileSystemCas } from "@lervo/cas";
import {
  createConversationInboundEvent,
  createConversationParticipationDecision,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { defaultEnglishWritingContract } from "@lervo/core";
import { HubControlReviewGrants, type HubCommandReview } from "@lervo/hub-control";
import type { WritingSemanticEvaluator } from "@lervo/writing";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ConfiguredConversationDeliberationControl,
  ConfiguredConversationHubControl,
  ConversationControlResponder,
  parseConversationControlCommand,
} from "../src/index.js";

const roots: string[] = [];
const deliveryId = `rcd_${"a".repeat(64)}`;

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function review(): HubCommandReview {
  return {
    schemaVersion: 1,
    destinationId: "hub:primary",
    projectId: "prj_control01",
    projectIdentityHash: `sha256:${"b".repeat(64)}`,
    delivery: {
      deliveryId,
      commandId: `rcm_${"c".repeat(64)}`,
      status: "pending",
      attemptCount: 0,
      queuedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-20T01:00:00.000Z",
      terminalAt: null,
    },
    command: {
      roleId: "developer",
      provider: "codex",
      risk: "medium",
      verificationSuiteIds: ["repo.check"],
      issuedAt: "2026-08-20T00:00:00.000Z",
      expiresAt: "2026-08-20T01:00:00.000Z",
    },
    approval: {
      state: "approval_required",
      snapshotId: `pols_${"d".repeat(64)}`,
      maximumExpiresAt: "2026-08-20T00:50:00.000Z",
      hadRevokedApproval: false,
      options: [{ capability: "filesystem.write", repositoryPaths: ["src/result.ts"], approvalId: null }],
    },
    inspectedAt: "2026-08-20T00:05:00.000Z",
  };
}

function evaluator(): WritingSemanticEvaluator {
  return {
    async evaluate(request) {
      return {
        evaluator: { kind: "model", evaluatorId: "fixture.control-writing.v1" },
        checks: request.checks.map((check) => ({
          checkId: check.checkId,
          status: "passed" as const,
          violationCount: 0,
        })),
      };
    },
  };
}

async function fixtureMessage(content: string) {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-conversation-control-"));
  roots.push(root);
  const artifacts = await FileSystemCas.open(root);
  const stored = await artifacts.put(content);
  return {
    artifacts,
    event: createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("native/control-message-1"),
      target: {
        integrationId: "itg_native001",
        projectId: "prj_control01",
        conversationId: "cnv_control01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_control_message",
        contentHash: stored.contentHash,
        byteCount: stored.byteCount,
        mediaType: "text/plain; charset=utf-8",
      },
      mentions: { roleIds: [], participantIds: [] },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 0,
      occurredAt: "2026-08-20T00:04:00.000Z",
    }),
  };
}

describe("conversation command control", () => {
  it("accepts only an explicit deterministic command", () => {
    expect(parseConversationControlCommand(`/lervo approval ${deliveryId}`)).toEqual({
      operation: "approval_review",
      deliveryId,
    });
    expect(parseConversationControlCommand(`Please approve command ${deliveryId}`)).toBeNull();
    expect(parseConversationControlCommand(`/lervo approve ${deliveryId}`)).toBeNull();
    expect(parseConversationControlCommand(
      "/lervo deliberate start deliberation_product-review -- Review the deployment structure.",
    )).toEqual({
      operation: "deliberation_start",
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
    });
    expect(parseConversationControlCommand("/lervo deliberate status dlb_chat0001")).toEqual({
      operation: "deliberation_status",
      deliberationId: "dlb_chat0001",
    });
    expect(parseConversationControlCommand("/lervo deliberate resume dlb_chat0001")).toEqual({
      operation: "deliberation_resume",
      deliberationId: "dlb_chat0001",
    });
    expect(parseConversationControlCommand("Have Lervo agents discuss the deployment structure")).toBeNull();
  });

  it("routes deliberation start and status through one platform-neutral port", async () => {
    const { artifacts, event } = await fixtureMessage(
      "/lervo deliberate start deliberation_product-review -- Review the deployment structure.",
    );
    const start = vi.fn(async () => ({
      deliberationId: "dlb_chat0001",
      status: "running" as const,
      artifactCount: 0,
      nextAction: "wait" as const,
    }));
    const inspect = vi.fn(async () => ({
      deliberationId: "dlb_chat0001",
      status: "interrupted" as const,
      artifactCount: 3,
      nextAction: "resume" as const,
    }));
    const responder = new ConversationControlResponder({
      artifactStore: artifacts,
      control: { inspect: async () => ({ review: review(), reviewUrl: null }) },
      deliberations: { start, resume: vi.fn(), inspect },
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: evaluator(),
      now: () => new Date("2026-08-20T00:05:00.000Z"),
    });
    const policy = createConversationParticipationPolicy({
      projectId: "prj_control01",
      roleId: "reviewer",
      conversationIds: ["cnv_control01"],
      mode: "relevant",
      respondTo: ["human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 10,
      maxAutomationDepth: 2,
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    const decision = createConversationParticipationDecision({
      event,
      policy,
      action: "respond",
      reason: "relevant",
      relevance: "relevant",
      decidedAt: "2026-08-20T00:04:30.000Z",
    });
    const candidate = await responder.respond({ event, policy, decision });
    const body = Buffer.from(await artifacts.get(
      `lervo-cas://sha256/${candidate.content.contentHash.slice(7)}`,
    )).toString("utf8");

    expect(start).toHaveBeenCalledWith({
      event,
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
      requestedAt: "2026-08-20T00:05:00.000Z",
    });
    expect(inspect).not.toHaveBeenCalled();
    expect(body).toContain("Processed deliberation dlb_chat0001.");
    expect(body).toContain("Wait for the current work to finish.");
  });

  it("publishes a writing-gated review reply without creating an approval", async () => {
    const { artifacts, event } = await fixtureMessage(`/lervo approval ${deliveryId}`);
    const inspect = vi.fn(async () => ({
      review: review(),
      reviewUrl: `https://hub.example/control#destinationId=hub%3Aprimary&projectId=prj_control01&deliveryId=${deliveryId}&reviewGrant=hcrg_1787184900_${"e".repeat(64)}`,
    }));
    const responder = new ConversationControlResponder({
      artifactStore: artifacts,
      control: { inspect },
      writingContract: defaultEnglishWritingContract,
      semanticEvaluator: evaluator(),
      now: () => new Date("2026-08-20T00:05:00.000Z"),
    });

    const policy = createConversationParticipationPolicy({
      projectId: "prj_control01",
      roleId: "reviewer",
      conversationIds: ["cnv_control01"],
      mode: "relevant",
      respondTo: ["human"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 10,
      maxAutomationDepth: 2,
      createdAt: "2026-08-20T00:00:00.000Z",
    });
    const decision = createConversationParticipationDecision({
      event,
      policy,
      action: "respond",
      reason: "relevant",
      relevance: "relevant",
      decidedAt: "2026-08-20T00:04:30.000Z",
    });
    const candidate = await responder.respond({
      event,
      policy,
      decision,
    });
    const body = Buffer.from(await artifacts.get(
      `lervo-cas://sha256/${candidate.content.contentHash.slice(7)}`,
    )).toString("utf8");

    expect(inspect).toHaveBeenCalledOnce();
    expect(body).toContain("No approval was created in this conversation.");
    expect(body).toContain("Reauthenticate and review the scope");
    expect(body).not.toContain("operator:reviewer");
    expect(candidate.publicationEvidence.evaluation.overallStatus).toBe("passed");
    expect(candidate.publicationPermit.surface).toBe("chat");
  });

  it("uses the actor binding to issue a grant that only the same Hub principal can use", async () => {
    const grants = new HubControlReviewGrants(Buffer.alloc(32, 3), { ttlSeconds: 600 });
    const inspect = vi.fn(async () => review());
    const control = new ConfiguredConversationHubControl({
      reader: { inspect } as never,
      reviewGrants: grants,
      reviewBaseUrl: "https://hub.example/control",
      bindings: [{
        projectId: "prj_control01",
        participantId: "ptc_human001",
        principalId: "operator:reviewer",
        destinationId: "hub:primary",
        permissions: ["command.read", "approval.review"],
      }],
    });
    const { event } = await fixtureMessage(`/lervo approval ${deliveryId}`);
    const result = await control.inspect({
      event,
      operation: "approval_review",
      deliveryId,
      inspectedAt: "2026-08-20T00:05:00.000Z",
    });
    const fragment = new URLSearchParams(new URL(result.reviewUrl!).hash.slice(1));
    const grant = fragment.get("reviewGrant")!;

    expect(grants.verify({
      grant,
      principalId: "operator:reviewer",
      destinationId: "hub:primary",
      projectId: "prj_control01",
      deliveryId,
      verifiedAt: "2026-08-20T00:06:00.000Z",
    })).toBe(true);
    expect(grants.verify({
      grant,
      principalId: "operator:someone-else",
      destinationId: "hub:primary",
      projectId: "prj_control01",
      deliveryId,
      verifiedAt: "2026-08-20T00:06:00.000Z",
    })).toBe(false);
  });

  it("binds deliberation operations to the human project principal", async () => {
    const start = vi.fn(async () => ({
      deliberationId: "dlb_chat0001",
      status: "running" as const,
      artifactCount: 0,
      nextAction: "wait" as const,
    }));
    const resume = vi.fn(async () => ({
      deliberationId: "dlb_chat0001",
      status: "running" as const,
      artifactCount: 0,
      nextAction: "wait" as const,
    }));
    const backend = {
      start,
      resume,
      inspect: async () => ({
        deliberationId: "dlb_chat0001",
        status: "running" as const,
        artifactCount: 0,
        nextAction: "wait" as const,
      }),
    };
    const control = new ConfiguredConversationDeliberationControl({
      backend,
      bindings: [{
        projectId: "prj_control01",
        participantId: "ptc_human001",
        principalId: "operator:reviewer",
        permissions: ["deliberation.start", "deliberation.resume", "deliberation.read"],
      }],
    });
    const { event } = await fixtureMessage(
      "/lervo deliberate start deliberation_product-review -- Review the deployment structure.",
    );

    await control.start({
      event,
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
      requestedAt: "2026-08-20T00:05:00.000Z",
    });

    expect(start).toHaveBeenCalledWith({
      projectId: "prj_control01",
      principalId: "operator:reviewer",
      sourceEventId: event.eventId,
      policyId: "deliberation_product-review",
      topic: "Review the deployment structure.",
      requestedAt: "2026-08-20T00:05:00.000Z",
    });
    await control.resume({
      event,
      deliberationId: "dlb_chat0001",
      requestedAt: "2026-08-20T00:06:00.000Z",
    });
    expect(resume).toHaveBeenCalledWith({
      projectId: "prj_control01",
      principalId: "operator:reviewer",
      sourceEventId: event.eventId,
      deliberationId: "dlb_chat0001",
      requestedAt: "2026-08-20T00:06:00.000Z",
    });
    expect(() => new ConfiguredConversationDeliberationControl({
      backend,
      bindings: [{
        projectId: "prj_control01",
        participantId: "ptc_human001",
        principalId: "operator:reviewer",
        permissions: ["deliberation.delete" as never],
      }],
    })).toThrow("binding");
  });
});
