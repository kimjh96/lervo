import { createHash } from "node:crypto";

import type { ConversationApplication } from "@lervo/conversation-app";
import type { ConversationInboundEvent } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";
import { describe, expect, it, vi } from "vitest";

import { ConversationDeliberationOutcomeCoordinator } from "../src/conversation-deliberation-outcomes.js";

function fixture() {
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
  const deliver = vi.fn(async () => ({ status: "idle" as const }));
  const application = {
    handleInboundEvent: async (event: ConversationInboundEvent) => {
      events.push(event);
      return [];
    },
    runDeliveryCycle: deliver,
    reconcileDeliberation: vi.fn(),
  } as unknown as ConversationApplication;
  const coordinator = new ConversationDeliberationOutcomeCoordinator({
    projectId: "prj_control01",
    integrationId: "itg_discord01",
    conversationIds: ["cnv_operator01"],
    artifactStore,
    maximumReconciliationAttempts: 2,
    now: () => new Date("2026-09-09T00:00:00.000Z"),
  });
  return { application, artifactStore, coordinator, events, deliver };
}

describe("conversation deliberation outcome coordinator", () => {
  it("publishes a bounded managed signal for a verified terminal outcome", async () => {
    const { application, artifactStore, coordinator, events, deliver } = fixture();
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
    });
    const content = new TextDecoder().decode(
      await artifactStore.get(`lervo-cas://sha256/${events[0]!.content!.contentHash.slice(7)}`),
    );
    expect(content).toContain("verified decision");
    expect(content).toContain("Published artifact count: 4");
    expect(content).not.toContain("dlb_queue0001");
    expect(deliver).toHaveBeenCalledWith("itg_discord01");
  });

  it("reconciles from canonical evidence without rerunning uncertain work", async () => {
    const { application, coordinator, events } = fixture();
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
    });
    await coordinator.reconcilePending(application);
    expect(application.reconcileDeliberation).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signalCode: "deliberation.completed" });
  });

  it("emits one visible attention signal after bounded inconclusive inspections", async () => {
    const { application, coordinator, events } = fixture();
    vi.mocked(application.reconcileDeliberation!).mockResolvedValue({
      status: "not_confirmed",
      reason: "history_incomplete",
    });
    await coordinator.observe(application, {
      status: "uncertain",
      deliberationId: "dlb_queue0001",
      failureCode: "deliberation_execution_uncertain",
    });
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(0);
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ signalCode: "deliberation.attention" });
    await coordinator.reconcilePending(application);
    expect(events).toHaveLength(1);
  });
});
