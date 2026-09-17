import { createHash } from "node:crypto";

import type { ConversationApplication } from "@lervo/conversation-app";
import type {
  ConversationDeliberationNotification,
  ConversationDeliberationOriginReference,
} from "@lervo/conversation-control";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import { ConversationDeliberationOutcomeCoordinator } from "../src/conversation-deliberation-outcomes.js";

const origin = {
  sourceEventId: `cve_${"a".repeat(64)}`,
  conversationId: "cnv_origin01",
  threadId: "thd_origin01",
  requesterParticipantId: "ptc_requester01",
  originBindingDigest: `sha256:${"b".repeat(64)}`,
  responseLanguage: "en",
} as const;

function fixture(
  input: {
    origin?: ConversationDeliberationOriginReference | null;
    notification?: ConversationDeliberationNotification | null;
    interactionResult?: "responded" | "busy" | "multiple";
    sourceEventKeys?: Set<string>;
    resultContent?: string;
  } = {},
) {
  const bytes = new Map<string, Uint8Array>();
  const put: ArtifactStore["put"] = async (content) => {
    const value = typeof content === "string" ? new TextEncoder().encode(content) : content;
    const contentHash = `sha256:${createHash("sha256").update(value).digest("hex")}`;
    const uri = `lervo-cas://sha256/${contentHash.slice(7)}`;
    bytes.set(uri, value);
    return { uri, contentHash, byteCount: value.byteLength, created: true };
  };
  const artifactStore: ArtifactStore = {
    put,
    putStream: async (chunks) => {
      const collected: Uint8Array[] = [];
      for await (const chunk of chunks) {
        collected.push(typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk);
      }
      return put(Buffer.concat(collected));
    },
    get: async (uri) => bytes.get(uri)!,
    has: async (uri) => bytes.has(uri),
  };
  const events: ConversationInboundEvent[] = [];
  const sourceEventKeys = input.sourceEventKeys ?? new Set<string>();
  const deliver = vi.fn(async () => ({ status: "idle" as const }));
  const inspectDeliberationOrigin = vi.fn(async () =>
    input.origin === undefined ? origin : input.origin,
  );
  let notification = input.notification;
  const acceptDeliberationNotification = vi.fn(async () => {
    notification = null;
  });
  const application = {
    inspectDeliberationOrigin,
    claimDeliberationNotification: vi.fn(async () =>
      notification === null || notification === undefined
        ? null
        : {
            leaseId: `cdn_${"c".repeat(32)}`,
            notification,
            origin: input.origin === undefined ? origin : input.origin,
          },
    ),
    acceptDeliberationNotification,
    listUncertainDeliberations: vi.fn(async () => []),
    hasConversationSourceEventKeyHash: vi.fn((sourceEventKeyHash: string) =>
      sourceEventKeys.has(sourceEventKeyHash),
    ),
    handleInboundEvent: async (event: ConversationInboundEvent) => {
      events.push(event);
      sourceEventKeys.add(event.sourceEventKeyHash);
      const responded = {
        policyId: "fixture",
        roleId: "fixture",
        result: { status: "completed" as const, decision: {}, outbound: {} },
      };
      return input.interactionResult === "busy"
        ? [{ policyId: "fixture", roleId: "fixture", result: { status: "busy" as const } }]
        : input.interactionResult === "multiple"
          ? [responded, { ...responded, roleId: "fixture-two" }]
          : [responded];
    },
    runDeliveryCycle: deliver,
    reconcileDeliberation: vi.fn(),
  } as unknown as ConversationApplication;
  const coordinator = new ConversationDeliberationOutcomeCoordinator({
    projectId: "prj_control01",
    integrationId: "itg_discord01",
    conversationIds: ["cnv_operator01"],
    artifactStore,
    resultSource: {
      read: async () => {
        const status = notification?.summary.status;
        return {
          status:
            status === "interrupted" ||
            status === "converged" ||
            status === "no_consensus" ||
            status === "failed"
              ? status
              : "converged",
          content: input.resultContent ?? "Adopt the reviewed product boundary.",
        };
      },
    },
    maximumReconciliationAttempts: 2,
    now: () => new Date("2026-09-09T00:00:00.000Z"),
  });
  return {
    application,
    artifactStore,
    coordinator,
    events,
    deliver,
    inspectDeliberationOrigin,
    acceptDeliberationNotification,
  };
}

function terminalNotification(
  status: "converged" | "no_consensus" | "failed" = "converged",
): ConversationDeliberationNotification {
  return {
    operation: "start",
    projectId: "prj_control01",
    deliberationId: "dlb_queue0001",
    summary: {
      deliberationId: "dlb_queue0001",
      status,
      artifactCount: status === "converged" ? 4 : 3,
      nextAction: "none",
    },
    occurredAt: "2026-09-09T00:00:00.000Z",
    state: "leased",
    attemptCount: 1,
    leaseExpiresAt: "2026-09-09T00:05:00.000Z",
    conversationEventId: null,
    acceptedAt: null,
  };
}

describe("conversation deliberation outcome coordinator", () => {
  it("publishes a bounded managed signal for a verified terminal outcome", async () => {
    const {
      application,
      artifactStore,
      coordinator,
      events,
      deliver,
      acceptDeliberationNotification,
    } = fixture({ notification: terminalNotification() });
    await coordinator.observe(application, {
      status: "settled",
      deliberationId: "dlb_queue0001",
      summary: {
        deliberationId: "dlb_queue0001",
        status: "converged",
        artifactCount: 4,
        nextAction: "none",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "signal.raised",
      signalCode: "deliberation.completed",
      target: {
        integrationId: "itg_discord01",
        projectId: "prj_control01",
        conversationId: "cnv_origin01",
        threadId: "thd_origin01",
      },
      mentions: { roleIds: [], participantIds: ["ptc_requester01"] },
      replyToEventId: origin.sourceEventId,
    });
    const content = new TextDecoder().decode(
      await artifactStore.get(`lervo-cas://sha256/${events[0]!.content!.contentHash.slice(7)}`),
    );
    expect(content).toContain("verified decision");
    expect(content).toContain("Adopt the reviewed product boundary.");
    expect(content).not.toContain("Published artifact count");
    expect(content).not.toContain("dlb_queue0001");
    expect(deliver).toHaveBeenCalledWith("itg_discord01");
    expect(acceptDeliberationNotification).toHaveBeenCalledWith({
      operation: "start",
      deliberationId: "dlb_queue0001",
      leaseId: `cdn_${"c".repeat(32)}`,
      conversationEventId: events[0]!.eventId,
    });
  });

  it("publishes the complete terminal outcome in Korean for a Korean origin", async () => {
    const koreanOrigin = { ...origin, responseLanguage: "ko" as const };
    const { application, artifactStore, coordinator, events } = fixture({
      origin: koreanOrigin,
      notification: terminalNotification(),
      resultContent: "검토한 제품 경계를 채택합니다.",
    });

    await coordinator.observe(application, {
      status: "settled",
      deliberationId: "dlb_queue0001",
      summary: terminalNotification().summary,
    });

    const content = new TextDecoder().decode(
      await artifactStore.get(`lervo-cas://sha256/${events[0]!.content.contentHash.slice(7)}`),
    );
    expect(content).toContain("검증된 결론에 도달했습니다");
    expect(content).toContain("검토한 제품 경계를 채택합니다");
    expect(content).not.toContain("independent review");
    expect(events[0]!.replyToEventId).toBe(origin.sourceEventId);
  });

  it("uses configured conversation fan-out only for a legacy job without an origin", async () => {
    const { application, coordinator, events } = fixture({
      origin: null,
      notification: terminalNotification("no_consensus"),
    });
    await coordinator.observe(application, {
      status: "settled",
      deliberationId: "dlb_queue0001",
      summary: {
        deliberationId: "dlb_queue0001",
        status: "no_consensus",
        artifactCount: 3,
        nextAction: "none",
      },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      target: {
        conversationId: "cnv_operator01",
        threadId: null,
      },
      mentions: { roleIds: [], participantIds: [] },
      replyToEventId: null,
    });
  });

  it("keeps the durable notification retryable until exactly one outbound exists", async () => {
    const { application, coordinator, acceptDeliberationNotification, deliver } = fixture({
      notification: terminalNotification(),
      interactionResult: "busy",
    });

    await expect(
      coordinator.observe(application, {
        status: "settled",
        deliberationId: "dlb_queue0001",
        summary: terminalNotification().summary,
      }),
    ).rejects.toThrow(/Exactly one conversation policy/);
    expect(acceptDeliberationNotification).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
  });

  it("reconciles from canonical evidence without rerunning uncertain work", async () => {
    const { application, coordinator, events } = fixture({
      notification: terminalNotification("no_consensus"),
    });
    vi.mocked(application.reconcileDeliberation!).mockResolvedValue({
      status: "reconciled",
      summary: {
        deliberationId: "dlb_queue0001",
        status: "no_consensus",
        artifactCount: 3,
        nextAction: "none",
      },
    });
    await coordinator.observe(application, {
      status: "uncertain",
      deliberationId: "dlb_queue0001",
      failureCode: "deliberation_execution_uncertain",
      uncertainAt: "2026-09-09T00:00:00.000Z",
    });
    await coordinator.reconcilePending(application);
    expect(application.reconcileDeliberation).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signalCode: "deliberation.completed" });
  });

  it("emits one visible attention signal after bounded inconclusive inspections", async () => {
    const { application, artifactStore, coordinator, events } = fixture();
    vi.mocked(application.reconcileDeliberation!).mockResolvedValue({
      status: "not_confirmed",
      reason: "history_incomplete",
    });
    await coordinator.observe(application, {
      status: "uncertain",
      deliberationId: "dlb_queue0001",
      failureCode: "deliberation_execution_uncertain",
      uncertainAt: "2026-09-09T00:00:00.000Z",
    });
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(0);
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      signalCode: "deliberation.attention",
      target: { conversationId: "cnv_origin01", threadId: "thd_origin01" },
      replyToEventId: origin.sourceEventId,
    });
    const content = new TextDecoder().decode(
      await artifactStore.get(`lervo-cas://sha256/${events[0]!.content!.contentHash.slice(7)}`),
    );
    expect(content).toContain("couldn't complete this review safely");
    expect(content).not.toContain("canonical event history");
    expect(content).not.toContain("checkpoint");
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(1);
  });

  it("keeps an exhausted attention obligation retryable until interaction ownership succeeds", async () => {
    const { application, coordinator, events } = fixture();
    vi.mocked(application.reconcileDeliberation!).mockResolvedValue({
      status: "not_confirmed",
      reason: "history_incomplete",
    });
    const handle = application.handleInboundEvent!;
    let rejectOnce = true;
    application.handleInboundEvent = async (event) => {
      if (rejectOnce) {
        rejectOnce = false;
        throw new Error("interaction store unavailable");
      }
      return handle(event);
    };
    await coordinator.observe(application, {
      status: "uncertain",
      deliberationId: "dlb_queue0001",
      failureCode: "deliberation_execution_uncertain",
      uncertainAt: "2026-09-09T00:00:00.000Z",
    });

    await coordinator.reconcilePending(application);
    await expect(coordinator.reconcilePending(application)).rejects.toThrow(
      "interaction store unavailable",
    );
    expect(events).toHaveLength(0);
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signalCode: "deliberation.attention" });
  });

  it("recovers an uncertain reconciliation obligation after coordinator restart", async () => {
    const { application, coordinator, events } = fixture({
      notification: terminalNotification("failed"),
    });
    vi.mocked(application.listUncertainDeliberations).mockResolvedValue([
      {
        deliberationId: "dlb_queue0001",
        uncertainAt: "2026-09-09T00:00:00.000Z",
      },
    ]);
    vi.mocked(application.reconcileDeliberation!).mockResolvedValue({
      status: "reconciled",
      summary: terminalNotification("failed").summary,
    });

    await coordinator.reconcilePending(application);

    expect(application.reconcileDeliberation).toHaveBeenCalledWith({
      projectId: "prj_control01",
      deliberationId: "dlb_queue0001",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      signalCode: "deliberation.completed",
      target: { conversationId: "cnv_origin01", threadId: "thd_origin01" },
    });
  });

  it("keeps exhausted attention identity stable across coordinator restarts", async () => {
    const sourceEventKeys = new Set<string>();
    const first = fixture({ sourceEventKeys });
    const second = fixture({ sourceEventKeys });
    const uncertainty = {
      deliberationId: "dlb_queue0001",
      uncertainAt: "2026-09-09T00:00:00.000Z",
    };
    for (const current of [first, second]) {
      vi.mocked(current.application.listUncertainDeliberations).mockResolvedValue([uncertainty]);
      vi.mocked(current.application.reconcileDeliberation!).mockResolvedValue({
        status: "not_confirmed",
        reason: "history_incomplete",
      });
      await current.coordinator.reconcilePending(current.application);
      await current.coordinator.reconcilePending(current.application);
    }

    expect(first.events).toHaveLength(1);
    expect(first.events[0]!.occurredAt).toBe(uncertainty.uncertainAt);
    expect(second.events).toHaveLength(0);
  });
});
