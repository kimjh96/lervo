import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import { NativeChatConversationAdapter } from "@lervo/adapter-native-chat";
import {
  createConversationInboundEvent,
  createConversationParticipationPolicy,
  hashConversationSourceEventKey,
} from "@lervo/conversation-contract";
import { handleConversationEvent, runConversationDeliveryCycle } from "@lervo/interaction";
import type { WritingPublicationPermit } from "@lervo/schemas";
import { calculateWritingPublicationPermitId } from "@lervo/writing-contract";

import { SQLiteConversationInteractionStore } from "../src/index.js";

const roots: string[] = [];

async function databasePath(): Promise<string> {
  const root = await mkdtemp(resolve(tmpdir(), "lervo-interaction-"));
  roots.push(root);
  return resolve(root, "state/interaction.sqlite");
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const responseContent = {
  artifactId: "art_response1",
  contentHash: "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  byteCount: 34,
  mediaType: "text/plain; charset=utf-8" as const,
};

function publicationPermit(): WritingPublicationPermit {
  const content: Omit<WritingPublicationPermit, "permitId"> = {
    schemaVersion: 1,
    surface: "chat",
    artifactId: responseContent.artifactId,
    contentHash: responseContent.contentHash,
    writingPolicyId: "writing_korean_chat",
    writingPolicyHash: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    evaluationId: "wre_evaluate01",
    evaluationHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    issuedAt: "2026-08-20T00:00:02.000Z",
  };
  return { ...content, permitId: calculateWritingPublicationPermitId(content) };
}

function responseCandidate() {
  return {
    content: responseContent,
    publicationPermit: publicationPermit(),
    publicationEvidence: {
      artifact: {
        ...responseContent,
        uri: `lervo-cas://sha256/${responseContent.contentHash.slice(7)}`,
        mediaType: "text/markdown; charset=utf-8" as const,
      },
      evaluation: {
        schemaVersion: 1 as const,
        evaluationId: "wre_evaluate01",
        writingPolicyId: "writing_korean_chat",
        artifactId: responseContent.artifactId,
        contentHash: responseContent.contentHash,
        locale: "ko-KR",
        checkedAt: "2026-08-20T00:00:02.000Z",
        evaluators: [{ kind: "deterministic" as const, evaluatorId: "fixture" }],
        checks: [
          {
            checkId: "fixture",
            kind: "deterministic" as const,
            status: "passed" as const,
            violationCount: 0,
            evidenceDigest: null,
          },
        ],
        overallStatus: "passed" as const,
      },
      evaluationArtifact: {
        artifactId: "art_evaluation01",
        uri: "lervo-cas://sha256/dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        mediaType: "application/vnd.lervo.writing-evaluation+json; charset=utf-8" as const,
        contentHash: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        byteCount: 10,
      },
    },
  };
}

function participationPolicy(
  conversationIds = ["cnv_general01"],
  roleId = "role_reviewer",
  cooldownSeconds = 0,
  unaddressedHumanMessages?: "evaluate" | "respond",
) {
  return createConversationParticipationPolicy({
    projectId: "prj_project01",
    roleId,
    conversationIds,
    mode: "relevant",
    respondTo: ["human"],
    ...(unaddressedHumanMessages === undefined ? {} : { unaddressedHumanMessages }),
    signalCodes: ["review.requested"],
    cooldownSeconds,
    maxResponsesPerHour: 5,
    maxAutomationDepth: 2,
    createdAt: "2026-08-20T00:00:00.000Z",
  });
}

describe("durable native chat interaction", () => {
  it("marks a delegated-task response as a result for the original coordinator", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const coordinatorParticipantId = "ptc_coordinator01";
    const event = createConversationInboundEvent({
      sourceEventKeyHash: hashConversationSourceEventKey("delegated-task-assignment"),
      target: {
        integrationId: "itg_native001",
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "agent", participantId: coordinatorParticipantId, roleId: "ceo" },
      content: {
        artifactId: "art_taskmessage01",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      coordination: {
        kind: "task.assignment",
        taskId: `tsk_${"q".repeat(20)}`,
        coordinatorParticipantId,
      },
      mentions: { roleIds: [], participantIds: ["ptc_agent001"] },
      replyToEventId: null,
      signalCode: null,
      automationDepth: 1,
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    const policy = createConversationParticipationPolicy({
      projectId: "prj_project01",
      roleId: "product-owner",
      conversationIds: ["cnv_general01"],
      mode: "relevant",
      respondTo: ["agent"],
      signalCodes: [],
      cooldownSeconds: 0,
      maxResponsesPerHour: 5,
      maxAutomationDepth: 8,
      createdAt: "2026-08-20T00:00:00.000Z",
    });

    await expect(
      handleConversationEvent({
        event,
        policy,
        workerId: "interaction-worker",
        agentParticipantId: "ptc_agent001",
        store,
        responder: { respond: async () => responseCandidate() },
        publicationVerifier: { verify: async () => undefined },
        relevanceEvaluator: { evaluate: async () => "relevant" },
        turnOwnershipEvaluator: { owns: () => true },
        clock: () => new Date("2026-08-20T00:00:02.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "completed",
      outbound: {
        coordination: {
          kind: "task.result",
          taskId: `tsk_${"q".repeat(20)}`,
          coordinatorParticipantId,
        },
      },
    });
    await store.close();
  });

  it("preserves host-native observation-only publication lineage", () => {
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "native-observation-only-publication",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "agent", participantId: "ptc_agent002", roleId: "role_writer" },
      content: {
        artifactId: "art_status001",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      audienceParticipation: "observe_only",
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    expect(event.audienceParticipation).toBe("observe_only");
  });

  it("records a non-owned turn without typing, relevance, or provider work", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "shared-non-owned-message",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    const startActivity = vi.fn(() => ({ stop: vi.fn() }));
    const relevance = vi.fn(async () => "relevant" as const);
    const respond = vi.fn(async () => responseCandidate());

    expect(store.hasInboundSourceEventKeyHash(event.sourceEventKeyHash)).toBe(false);

    await expect(
      handleConversationEvent({
        event,
        policy: participationPolicy(),
        workerId: "interaction-worker",
        agentParticipantId: "ptc_agent001",
        store,
        responder: { respond },
        publicationVerifier: { verify: async () => undefined },
        relevanceEvaluator: { evaluate: relevance },
        turnOwnershipEvaluator: { owns: () => false },
        responseActivity: { start: startActivity },
        clock: () => new Date("2026-08-20T00:00:02.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "completed",
      decision: { action: "observe", reason: "turn_not_owned" },
      outbound: null,
    });
    expect(startActivity).not.toHaveBeenCalled();
    expect(relevance).not.toHaveBeenCalled();
    expect(respond).not.toHaveBeenCalled();
    expect(store.hasInboundSourceEventKeyHash(event.sourceEventKeyHash)).toBe(true);
    expect(() => store.hasInboundSourceEventKeyHash("invalid")).toThrow(
      /source event key hash is invalid/,
    );
    await store.close();
  });

  it("recovers deduplication and delivery across restarts without storing raw platform data", async () => {
    const path = await databasePath();
    const rawSourceEventKey = "native/raw/message/private-42";
    const rawDeliveryKey = "native/raw/delivery/private-77";
    const rawBody = "This source text must remain only in the artifact store.";
    let deliveryAttempts = 0;
    const sent = vi.fn(async () => {
      deliveryAttempts += 1;
      if (deliveryAttempts === 1) throw new Error("temporary transport failure");
      return { deliveryKey: rawDeliveryKey, deliveredAt: "2026-08-20T00:00:05.000Z" };
    });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-service-private-instance",
      delivery: { send: sent },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: rawSourceEventKey,
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteCount: Buffer.byteLength(rawBody),
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    const policy = participationPolicy();
    const stopActivity = vi.fn();
    const startActivity = vi.fn(() => ({ stop: stopActivity }));
    const relevance = vi.fn(async () => {
      expect(startActivity).toHaveBeenCalledTimes(1);
      return "relevant" as const;
    });
    const responder = vi.fn(async () => responseCandidate());
    const verify = vi.fn(async ({ candidate }) => {
      expect(candidate.publicationPermit.surface).toBe("chat");
    });

    const first = await SQLiteConversationInteractionStore.open({ path });
    await expect(
      handleConversationEvent({
        event,
        policy,
        workerId: "interaction-worker-1",
        agentParticipantId: "ptc_agent001",
        store: first,
        responder: { respond: responder },
        publicationVerifier: { verify },
        relevanceEvaluator: { evaluate: relevance },
        responseActivity: { start: startActivity },
        clock: () => new Date("2026-08-20T00:00:02.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "completed",
      decision: { action: "respond", reason: "relevant" },
      outbound: { publicationPermit: { surface: "chat" } },
    });
    expect(first.auditIntegrity()).toEqual({
      valid: true,
      inboxCount: 1,
      decisionCount: 1,
      outboxCount: 1,
    });
    await first.close();

    const reopened = await SQLiteConversationInteractionStore.open({ path });
    await expect(
      handleConversationEvent({
        event,
        policy,
        workerId: "interaction-worker-2",
        agentParticipantId: "ptc_agent001",
        store: reopened,
        responder: { respond: responder },
        publicationVerifier: { verify },
        relevanceEvaluator: { evaluate: relevance },
        clock: () => new Date("2026-08-20T00:00:03.000Z"),
      }),
    ).resolves.toMatchObject({ status: "duplicate" });
    expect(relevance).toHaveBeenCalledTimes(1);
    expect(responder).toHaveBeenCalledTimes(1);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(startActivity).toHaveBeenCalledTimes(1);
    expect(stopActivity).toHaveBeenCalledTimes(1);

    await expect(
      runConversationDeliveryCycle({
        adapter,
        store: reopened,
        workerId: "delivery-worker-1",
        retryDelayMs: 1_000,
        clock: () => new Date("2026-08-20T00:00:03.000Z"),
      }),
    ).resolves.toEqual({
      status: "processed",
      deliveredCount: 0,
      retryScheduledCount: 1,
      attentionRequiredCount: 0,
      attention: [],
    });
    await expect(
      runConversationDeliveryCycle({
        adapter,
        store: reopened,
        workerId: "delivery-worker-2",
        clock: () => new Date("2026-08-20T00:00:04.000Z"),
        onDelivered: vi.fn(async ({ outbound, receipt }) => {
          expect(outbound.sourceEventId).toBe(event.eventId);
          expect(receipt.outboundId).toBe(outbound.outboundId);
          expect(reopened.auditIntegrity()).toMatchObject({ outboxCount: 1 });
        }),
      }),
    ).resolves.toEqual({
      status: "processed",
      deliveredCount: 1,
      retryScheduledCount: 0,
      attentionRequiredCount: 0,
      attention: [],
    });
    expect(sent).toHaveBeenCalledTimes(2);
    expect(reopened.auditIntegrity()).toMatchObject({ outboxCount: 1 });
    await reopened.close();

    const database = new DatabaseSync(path);
    expect(() =>
      database
        .prepare("UPDATE conversation_inbox SET status = 'pending' WHERE event_id = ?")
        .run(event.eventId),
    ).toThrow(/lifecycle/);
    expect(() =>
      database
        .prepare("UPDATE conversation_outbox SET status = 'pending' WHERE source_event_id = ?")
        .run(event.eventId),
    ).toThrow(/lifecycle/);
    database.close();

    const bytes = (await readFile(path)).toString("latin1");
    expect(bytes).not.toContain(rawSourceEventKey);
    expect(bytes).not.toContain(rawDeliveryKey);
    expect(bytes).not.toContain(rawBody);
  });

  it("rejects out-of-scope work before it can enter the durable inbox", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "source-key",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });

    await expect(
      handleConversationEvent({
        event,
        policy: participationPolicy(["cnv_other001"]),
        workerId: "interaction-worker",
        agentParticipantId: "ptc_agent001",
        store,
        responder: { respond: async () => responseCandidate() },
        publicationVerifier: { verify: async () => undefined },
        clock: () => new Date("2026-08-20T00:00:02.000Z"),
      }),
    ).rejects.toMatchObject({ code: "invalid_interaction_request" });
    expect(store.auditIntegrity()).toMatchObject({ inboxCount: 0 });
    await store.close();
  });

  it("lets multiple roles decide on the same message independently", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "shared-message-key",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    const respond = vi.fn(async () => responseCandidate());
    const common = {
      event,
      store,
      responder: { respond },
      publicationVerifier: { verify: async () => undefined },
      relevanceEvaluator: { evaluate: async () => "relevant" as const },
      clock: () => new Date("2026-08-20T00:00:02.000Z"),
    };

    await expect(
      handleConversationEvent({
        ...common,
        policy: participationPolicy(["cnv_general01"], "role_reviewer"),
        workerId: "reviewer-worker",
        agentParticipantId: "ptc_agent001",
      }),
    ).resolves.toMatchObject({ status: "completed", decision: { roleId: "role_reviewer" } });
    await expect(
      handleConversationEvent({
        ...common,
        policy: participationPolicy(["cnv_general01"], "role_writer"),
        workerId: "writer-worker",
        agentParticipantId: "ptc_agent002",
      }),
    ).resolves.toMatchObject({ status: "completed", decision: { roleId: "role_writer" } });
    await expect(
      handleConversationEvent({
        ...common,
        policy: participationPolicy(["cnv_general01"], "role_reviewer", 30),
        workerId: "reviewer-worker-after-policy-change",
        agentParticipantId: "ptc_agent001",
      }),
    ).resolves.toMatchObject({
      status: "duplicate",
      decision: { roleId: "role_reviewer", reason: "relevant" },
    });
    expect(respond).toHaveBeenCalledTimes(2);
    expect(store.auditIntegrity()).toEqual({
      valid: true,
      inboxCount: 2,
      decisionCount: 2,
      outboxCount: 2,
    });
    await store.close();
  });

  it("keeps normalized inbound identity immutable at the database boundary", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationInteractionStore.open({ path });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "source-key",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    await store.claimInbound({
      event,
      policy: participationPolicy(),
      workerId: "worker-1",
      claimedAt: "2026-08-20T00:00:02.000Z",
      leaseDurationMs: 30_000,
    });
    await store.close();

    const database = new DatabaseSync(path);
    expect(() =>
      database
        .prepare("UPDATE conversation_inbox SET event_json = ? WHERE event_id = ?")
        .run("{}", event.eventId),
    ).toThrow(/immutable/);
    database.close();
  });

  it("selects retryable input only for the exact current policy and role", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const normalize = (sourceEventKey: string, artifactId: string) =>
      adapter.normalizeInbound({
        sourceEventKey,
        target: {
          projectId: "prj_project01",
          conversationId: "cnv_general01",
          threadId: null,
        },
        kind: "message.created",
        actor: { kind: "human", participantId: "ptc_human001", roleId: null },
        content: {
          artifactId,
          contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          byteCount: 10,
          mediaType: "text/plain; charset=utf-8",
        },
        occurredAt: "2026-08-20T00:00:01.000Z",
      });
    const currentPolicy = participationPolicy();
    const oldPolicy = participationPolicy(["cnv_general01"], "role_reviewer", 30);
    const currentEvent = normalize("current-source", "art_current01");
    const oldEvent = normalize("old-source", "art_old00001");
    for (const [event, policy] of [
      [currentEvent, currentPolicy],
      [oldEvent, oldPolicy],
    ] as const) {
      const claim = await store.claimInbound({
        event,
        policy,
        workerId: "retry-worker",
        claimedAt: "2026-08-20T00:00:02.000Z",
        leaseDurationMs: 30_000,
      });
      if (claim.status !== "claimed") throw new Error("Expected a new durable inbox claim.");
      await store.rescheduleInbound({
        eventId: event.eventId,
        policyId: policy.policyId,
        roleId: policy.roleId,
        leaseId: claim.leaseId,
        failedAt: "2026-08-20T00:00:02.000Z",
        availableAt: "2026-08-20T00:00:03.000Z",
        failureCode: "response_generation_failed",
      });
    }

    expect(store.nextWakeupAt("itg_native001")).toBe(Date.parse("2026-08-20T00:00:03.000Z"));
    expect(store.nextWakeupAt("itg_other0001")).toBeNull();
    expect(
      store.nextWakeupAt("itg_native001", [{ policyId: "policy_absent", roleId: "role_absent" }]),
    ).toBeNull();
    expect(
      store.readyInbound({
        integrationId: "itg_native001",
        policyId: currentPolicy.policyId,
        roleId: currentPolicy.roleId,
        at: "2026-08-20T00:00:04.000Z",
        limit: 10,
      }),
    ).toEqual([
      { event: currentEvent, policyId: currentPolicy.policyId, roleId: currentPolicy.roleId },
    ]);
    await store.close();
  });

  it("ends a poisoned response with one verified user-visible failure after the attempt bound", async () => {
    const path = await databasePath();
    const store = await SQLiteConversationInteractionStore.open({ path });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:05.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "poisoned-response",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_message01",
        contentHash: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:01.000Z",
    });
    const responder = vi.fn(async () => {
      throw Object.assign(new Error("quarantined provider prose"), {
        code: "writing_publication_blocked",
      });
    });
    const terminalResponder = vi.fn(async () => responseCandidate());
    const terminalVerifier = vi.fn(async () => undefined);
    const common = {
      event,
      policy: participationPolicy(["cnv_general01"], "role_reviewer", 0, "respond"),
      workerId: "bounded-retry-worker",
      agentParticipantId: "ptc_agent001",
      agentBinding: {
        agentId: `agt_${"a".repeat(24)}`,
        roleVersion: "1.2.3",
        roleContractHash: `sha256:${"b".repeat(64)}`,
        roleProfileHash: `sha256:${"c".repeat(64)}`,
      },
      store,
      responder: { respond: responder },
      publicationVerifier: { verify: vi.fn(async () => undefined) },
      relevanceEvaluator: {
        evaluate: vi.fn(async () => {
          throw new Error("semantic participation must not gate an owned human message");
        }),
      },
      responseFailureClassifier: {
        classify: () => ({ failureCode: "response_writing_blocked" as const, retryable: true }),
      },
      terminalFailureResponder: { respond: terminalResponder },
      terminalFailurePublicationVerifier: { verify: terminalVerifier },
      maximumResponseAttempts: 2,
      retryDelayMs: 1_000,
    };

    await expect(
      handleConversationEvent({
        ...common,
        clock: () => new Date("2026-08-20T00:00:02.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "retry_scheduled",
      failureCode: "response_writing_blocked",
    });
    await expect(
      handleConversationEvent({
        ...common,
        clock: () => new Date("2026-08-20T00:00:04.000Z"),
      }),
    ).resolves.toMatchObject({
      status: "failed_terminal",
      failureCode: "response_writing_blocked",
      attemptCount: 2,
      outbound: {
        sourceEventId: event.eventId,
        actor: {
          agentBinding: {
            agentId: `agt_${"a".repeat(24)}`,
            roleVersion: "1.2.3",
          },
        },
      },
    });
    expect(responder).toHaveBeenCalledTimes(2);
    expect(terminalResponder).toHaveBeenCalledTimes(1);
    expect(terminalVerifier).toHaveBeenCalledTimes(1);
    expect(store.auditIntegrity()).toMatchObject({ inboxCount: 1, outboxCount: 1 });
    await store.close();

    const database = new DatabaseSync(path, { readOnly: true });
    expect(
      database
        .prepare(
          "SELECT status, attempt_count, last_failure_code FROM conversation_inbox WHERE event_id = ?",
        )
        .get(event.eventId),
    ).toEqual({
      status: "completed",
      attempt_count: 2,
      last_failure_code: "response_writing_blocked",
    });
    database.close();
  });

  it("renews an active inbox lease without incrementing the response attempt", async () => {
    const store = await SQLiteConversationInteractionStore.open({ path: await databasePath() });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: {
        send: async () => ({ deliveryKey: "unused", deliveredAt: "2026-08-20T00:00:03.000Z" }),
      },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "renewed-source",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_renewed01",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:00.000Z",
    });
    const policy = participationPolicy();
    const claim = await store.claimInbound({
      event,
      policy,
      workerId: "lease-worker-1",
      claimedAt: "2026-08-20T00:00:01.000Z",
      leaseDurationMs: 1_000,
    });
    if (claim.status !== "claimed") throw new Error("Expected the initial inbox lease.");
    await store.renewInbound({
      eventId: event.eventId,
      policyId: policy.policyId,
      roleId: policy.roleId,
      leaseId: claim.leaseId,
      renewedAt: "2026-08-20T00:00:01.800Z",
      leaseDurationMs: 1_000,
    });
    await expect(
      store.claimInbound({
        event,
        policy,
        workerId: "lease-worker-2",
        claimedAt: "2026-08-20T00:00:02.200Z",
        leaseDurationMs: 1_000,
      }),
    ).resolves.toEqual({ status: "busy" });
    await expect(
      store.claimInbound({
        event,
        policy,
        workerId: "lease-worker-2",
        claimedAt: "2026-08-20T00:00:03.000Z",
        leaseDurationMs: 1_000,
      }),
    ).resolves.toMatchObject({ status: "claimed", attemptCount: 2 });
    await store.close();
  });

  it("stops an undeliverable outbound after a bounded attempt count without claiming delivery", async () => {
    const path = await databasePath();
    const send = vi.fn(async () => {
      throw new Error("unavailable transport details must not enter the outbox");
    });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: { send },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "bounded-outbound-failure",
      target: {
        projectId: "prj_project01",
        conversationId: "cnv_general01",
        threadId: null,
      },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_request01",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:00.000Z",
    });
    const store = await SQLiteConversationInteractionStore.open({ path });
    await handleConversationEvent({
      event,
      policy: participationPolicy(),
      workerId: "response-worker",
      agentParticipantId: "ptc_agent001",
      store,
      responder: { respond: async () => responseCandidate() },
      publicationVerifier: { verify: async () => undefined },
      relevanceEvaluator: { evaluate: async () => "relevant" },
      clock: () => new Date("2026-08-20T00:00:02.000Z"),
    });
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await expect(
        runConversationDeliveryCycle({
          adapter,
          store,
          workerId: "delivery-worker",
          retryDelayMs: 1_000,
          clock: () => new Date(`2026-08-20T00:00:0${attempt + 2}.000Z`),
        }),
      ).resolves.toMatchObject({
        deliveredCount: 0,
        retryScheduledCount: attempt < 3 ? 1 : 0,
        attentionRequiredCount: attempt === 3 ? 1 : 0,
      });
    }
    expect(store.auditIntegrity()).toMatchObject({ inboxCount: 1, outboxCount: 1 });
    await store.close();

    const reopened = await SQLiteConversationInteractionStore.open({ path });
    await expect(
      runConversationDeliveryCycle({
        adapter,
        store: reopened,
        workerId: "delivery-after-restart",
        clock: () => new Date("2026-08-20T00:00:20.000Z"),
      }),
    ).resolves.toMatchObject({ status: "idle", attentionRequiredCount: 0 });
    await reopened.close();
    expect(send).toHaveBeenCalledTimes(3);

    const database = new DatabaseSync(path, { readOnly: true });
    const attention = database
      .prepare(
        "SELECT outbound_id, status, attempt_count, last_failure_code, lease_id, receipt_json FROM conversation_outbox",
      )
      .get();
    expect(attention).toMatchObject({
      status: "attention_required",
      attempt_count: 3,
      last_failure_code: "adapter_delivery_failed",
      lease_id: null,
      receipt_json: null,
    });
    expect(database.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    database.close();

    const receipt = {
      schemaVersion: 1 as const,
      outboundId: attention!.outbound_id as string,
      integrationId: "itg_native001",
      deliveryKeyHash: `sha256:${"b".repeat(64)}`,
      deliveredAt: "2026-08-20T00:00:06.000Z",
    };
    const recovery = await SQLiteConversationInteractionStore.open({ path });
    await expect(
      recovery.acknowledgeReconciledOutbound({
        outboundId: receipt.outboundId,
        expectedAttemptCount: 3,
        expectedFailureCode: "wrong_failure",
        receipt,
      }),
    ).rejects.toMatchObject({ code: "lease_mismatch" });
    await recovery.acknowledgeReconciledOutbound({
      outboundId: receipt.outboundId,
      expectedAttemptCount: 3,
      expectedFailureCode: "adapter_delivery_failed",
      receipt,
    });
    await recovery.acknowledgeReconciledOutbound({
      outboundId: receipt.outboundId,
      expectedAttemptCount: 3,
      expectedFailureCode: "adapter_delivery_failed",
      receipt,
    });
    expect(recovery.auditIntegrity()).toMatchObject({ outboxCount: 1 });
    await recovery.close();

    const legacyMetadata = new DatabaseSync(path);
    legacyMetadata.exec("UPDATE interaction_meta SET value = '1'; PRAGMA user_version = 1;");
    legacyMetadata.close();
    const migrated = await SQLiteConversationInteractionStore.open({ path });
    expect(migrated.auditIntegrity()).toMatchObject({ outboxCount: 1 });
    await migrated.close();
    const migratedDatabase = new DatabaseSync(path, { readOnly: true });
    expect(migratedDatabase.prepare("PRAGMA user_version").get()).toEqual({ user_version: 2 });
    expect(migratedDatabase.prepare("SELECT status FROM conversation_outbox").get()).toEqual({
      status: "delivered",
    });
    migratedDatabase.close();
  });

  it("never delivers past attentionAfter when interrupted attempts keep re-claiming an outbound", async () => {
    const path = await databasePath();
    const send = vi.fn(async () => {
      throw new Error("not reached");
    });
    const adapter = new NativeChatConversationAdapter({
      integrationId: "itg_native001",
      instanceIdentity: "native-instance",
      delivery: { send },
    });
    const event = adapter.normalizeInbound({
      sourceEventKey: "interrupted-outbound-attempts",
      target: { projectId: "prj_project01", conversationId: "cnv_general01", threadId: null },
      kind: "message.created",
      actor: { kind: "human", participantId: "ptc_human001", roleId: null },
      content: {
        artifactId: "art_request01",
        contentHash: `sha256:${"a".repeat(64)}`,
        byteCount: 10,
        mediaType: "text/plain; charset=utf-8",
      },
      occurredAt: "2026-08-20T00:00:00.000Z",
    });
    const store = await SQLiteConversationInteractionStore.open({ path });
    await handleConversationEvent({
      event,
      policy: participationPolicy(),
      workerId: "response-worker",
      agentParticipantId: "ptc_agent001",
      store,
      responder: { respond: async () => responseCandidate() },
      publicationVerifier: { verify: async () => undefined },
      relevanceEvaluator: { evaluate: async () => "relevant" },
      clock: () => new Date("2026-08-20T00:00:02.000Z"),
    });
    // Each claim whose lease expires without a recorded outcome models a crashed or hung attempt.
    for (let interrupted = 1; interrupted <= 3; interrupted += 1) {
      await expect(
        store.claimOutbound({
          integrationId: "itg_native001",
          workerId: "interrupted-worker",
          claimedAt: `2026-08-20T00:00:${String(interrupted * 10).padStart(2, "0")}.000Z`,
          leaseDurationMs: 1_000,
          limit: 1,
        }),
      ).resolves.toMatchObject([{ attemptCount: interrupted }]);
    }
    const first = await runConversationDeliveryCycle({
      adapter,
      store,
      workerId: "delivery-worker",
      leaseDurationMs: 1_000,
      maximumDeliveryAttempts: 3,
      clock: () => new Date("2026-08-20T00:01:00.000Z"),
    });
    expect(first).toMatchObject({
      deliveredCount: 0,
      retryScheduledCount: 0,
      attentionRequiredCount: 1,
      attention: [
        {
          integrationId: "itg_native001",
          failureCode: "delivery_attempt_ceiling_exceeded",
          reason: "attempt_ceiling_exceeded",
          attemptCount: 4,
          attentionAfter: 3,
          owner: "conversation_integration_operator",
          recoveryCondition: "verified_receipt_reconciliation",
        },
      ],
    });
    for (let cycle = 0; cycle < 20; cycle += 1) {
      await expect(
        runConversationDeliveryCycle({
          adapter,
          store,
          workerId: "delivery-worker",
          clock: () => new Date(Date.parse("2026-08-20T00:02:00.000Z") + cycle * 60_000),
        }),
      ).resolves.toMatchObject({ status: "idle", attentionRequiredCount: 0, attention: [] });
    }
    expect(send).not.toHaveBeenCalled();
    await store.close();
    const database = new DatabaseSync(path, { readOnly: true });
    expect(
      database
        .prepare("SELECT status, attempt_count, last_failure_code FROM conversation_outbox")
        .get(),
    ).toEqual({
      status: "attention_required",
      attempt_count: 4,
      last_failure_code: "delivery_attempt_ceiling_exceeded",
    });
    database.close();
  });
});
