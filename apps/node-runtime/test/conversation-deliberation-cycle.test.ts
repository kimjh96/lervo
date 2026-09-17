import type { ConversationApplication } from "@lervo/conversation-app";
import { describe, expect, it, vi } from "vitest";

import { runConversationDeliberationCycle } from "../src/conversation-deliberation-cycle.js";
import type { ConversationDeliberationOutcomeCoordinator } from "../src/conversation-deliberation-outcomes.js";

describe("conversation deliberation cycle", () => {
  it("projects new artifacts before a long-running worker completes", async () => {
    let settleStart!: () => void;
    const start = new Promise<{ status: "idle" }>((resolve) => {
      settleStart = () => resolve({ status: "idle" });
    });
    const artifacts = { runCycle: vi.fn(async () => ({ eventCount: 0, publicationCount: 0 })) };
    const outcomes = {
      observe: vi.fn(async () => undefined),
      reconcilePending: vi.fn(async () => undefined),
    } as unknown as ConversationDeliberationOutcomeCoordinator;
    const application = {
      runDeliberationWorkerCycle: () => start,
      runDeliberationResumeWorkerCycle: async () => ({ status: "idle" as const }),
    } as unknown as ConversationApplication;

    const cycle = runConversationDeliberationCycle({
      application,
      artifacts,
      outcomes,
      projectionIntervalMs: 1,
    });
    await vi.waitFor(() => expect(artifacts.runCycle.mock.calls.length).toBeGreaterThan(1));
    expect(outcomes.observe).not.toHaveBeenCalled();

    settleStart();
    await cycle;

    expect(outcomes.observe).toHaveBeenCalledTimes(2);
    expect(outcomes.reconcilePending).toHaveBeenCalledOnce();
  });

  it("keeps ownership of an active worker when live projection fails", async () => {
    let settleStart!: () => void;
    const start = new Promise<{ status: "idle" }>((resolve) => {
      settleStart = () => resolve({ status: "idle" });
    });
    const projectionError = new Error("projection unavailable");
    const artifacts = {
      runCycle: vi
        .fn<() => Promise<{ eventCount: number; publicationCount: number }>>()
        .mockResolvedValueOnce({ eventCount: 0, publicationCount: 0 })
        .mockRejectedValue(projectionError),
    };
    const outcomes = {
      observe: vi.fn(async () => undefined),
      reconcilePending: vi.fn(async () => undefined),
    } as unknown as ConversationDeliberationOutcomeCoordinator;
    const application = {
      runDeliberationWorkerCycle: () => start,
      runDeliberationResumeWorkerCycle: async () => ({ status: "idle" as const }),
    } as unknown as ConversationApplication;

    const cycle = runConversationDeliberationCycle({
      application,
      artifacts,
      outcomes,
      projectionIntervalMs: 1,
    });
    let cycleSettled = false;
    void cycle.then(
      () => {
        cycleSettled = true;
      },
      () => {
        cycleSettled = true;
      },
    );
    await vi.waitFor(() => expect(artifacts.runCycle).toHaveBeenCalledTimes(2));
    expect(cycleSettled).toBe(false);

    settleStart();
    await expect(cycle).rejects.toBe(projectionError);
    expect(outcomes.observe).not.toHaveBeenCalled();
  });
});
