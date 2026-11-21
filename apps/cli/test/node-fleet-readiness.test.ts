import { describe, expect, it } from "vitest";

import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

import { NodeFleetApplyError, recoverNodeFleetFailure } from "../src/node-fleet-apply-contract.js";
import {
  captureNodeFleetReadinessBaseline,
  observeNodeFleetReadiness,
} from "../src/node-fleet-readiness.js";

const notBefore = new Date("2026-10-06T00:00:00.000Z");
const supervisionAttention = {
  status: "unavailable" as const,
  failureCode: "supervision_attention_required",
  reasonCodes: ["preflight_repair_requires_review"],
};

function snapshot(
  sequence: number,
  overrides: Partial<NodeRuntimeHealthSnapshot> = {},
): NodeRuntimeHealthSnapshot {
  return {
    schemaVersion: 1,
    status: "ready",
    processId: 200,
    startedAt: notBefore.toISOString(),
    updatedAt: new Date(notBefore.getTime() + sequence * 500).toISOString(),
    sync: { status: "ready" },
    workstreamReplication: { status: "ready" },
    workspaceCoordination: { status: "disabled" },
    remoteControl: { status: "ready" },
    ...overrides,
  };
}

async function observe(
  readHealth: (attempt: number) => NodeRuntimeHealthSnapshot,
  baseline: Parameters<typeof observeNodeFleetReadiness>[0]["baseline"],
): Promise<{ result: Awaited<ReturnType<typeof observeNodeFleetReadiness>>; reads: number }> {
  let reads = 0;
  const result = await observeNodeFleetReadiness({
    path: "/fixture/node-runtime-health.json",
    notBefore,
    allowHubUnavailable: false,
    ports: {
      wait: async () => undefined,
      readHealth: async () => {
        reads += 1;
        return readHealth(reads);
      },
    },
    ...(baseline === undefined ? {} : { baseline }),
  });
  return { result, reads };
}

describe("Node fleet readiness observation", () => {
  it("accepts a replacement that keeps the predecessor's supervision attention and reports it", async () => {
    const baseline = await captureNodeFleetReadinessBaseline(
      "/fixture/node-runtime-health.json",
      {
        readHealth: async () =>
          snapshot(-10, { processId: 100, status: "degraded", supervision: supervisionAttention }),
      },
      notBefore,
    );
    expect(baseline.status).toBe("observed");
    const { result, reads } = await observe(
      (attempt) => snapshot(attempt, { status: "degraded", supervision: supervisionAttention }),
      baseline,
    );
    expect(reads).toBe(3);
    expect(result).toEqual({
      status: "ready",
      observations: 3,
      processId: 200,
      startedAt: notBefore.toISOString(),
      sync: "ready",
      workstreamReplication: "ready",
      workspaceCoordination: "disabled",
      remoteControl: "ready",
      conversation: "disabled",
      supervision: "unavailable:supervision_attention_required",
      baseline: "observed",
      carriedConditions: [
        {
          component: "supervision",
          status: "unavailable",
          failureCode: "supervision_attention_required",
          reasonCodes: ["preflight_repair_requires_review"],
        },
      ],
    });
  });

  it("names the newly failing component, its baseline, and the observation count on timeout", async () => {
    const baseline = await captureNodeFleetReadinessBaseline(
      "/fixture/node-runtime-health.json",
      { readHealth: async () => snapshot(-10, { processId: 100 }) },
      notBefore,
    );
    const failure = await observe(
      (attempt) => snapshot(attempt, { status: "degraded", supervision: supervisionAttention }),
      baseline,
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NodeFleetApplyError);
    expect(failure).toMatchObject({
      code: "node_fleet_readiness_timeout",
      message:
        "The Node runtime did not become ready: supervision=unavailable:supervision_attention_required (baseline disabled).",
      details: {
        readiness: {
          baseline: "observed",
          blockers: [
            {
              component: "supervision",
              observed: "unavailable:supervision_attention_required",
              baseline: "disabled",
            },
          ],
          lastStatus: "degraded",
          lastProcessId: 200,
          observations: 120,
        },
      },
    });
  });

  it("extends the window while slow startup keeps settling components", async () => {
    // A slow host: the first fresh snapshot appears after 25 seconds, synchronization settles
    // after 80 seconds, and replication after 125 seconds; each step resets the 60-second window.
    const { result, reads } = await observe((attempt) => {
      if (attempt < 50) return snapshot(-1, { processId: 100 });
      return snapshot(attempt, {
        status: attempt < 250 ? "starting" : "ready",
        sync: attempt < 160 ? { status: "pending" } : { status: "ready" },
        workstreamReplication: attempt < 250 ? { status: "pending" } : { status: "ready" },
      });
    }, undefined);
    expect(result.status).toBe("ready");
    expect(reads).toBe(252);
  });

  it("accepts a slow but live starting process whose heartbeat keeps advancing", async () => {
    // ADR-0480: components stay pending for 200 seconds, longer than the 60-second idle window,
    // while the same process refreshes `updatedAt` every five seconds.
    const { result, reads } = await observe((attempt) => {
      const pending = attempt < 400;
      return snapshot(pending ? Math.floor(attempt / 10) * 10 : attempt, {
        status: pending ? "starting" : "ready",
        sync: pending ? { status: "pending" } : { status: "ready" },
        workstreamReplication: pending ? { status: "pending" } : { status: "ready" },
        remoteControl: pending ? { status: "pending" } : { status: "ready" },
      });
    }, undefined);
    expect(result).toMatchObject({ status: "ready", processId: 200 });
    expect(reads).toBe(402);
  });

  it("counts the replacement's heartbeat even when the predecessor was still starting", async () => {
    // The predecessor, itself never ready, keeps writing fresh `starting` heartbeats until it
    // stops; the replacement then stays starting for 200 seconds while its heartbeat advances.
    const { result, reads } = await observe((attempt) => {
      if (attempt <= 20)
        return snapshot(attempt, {
          status: "starting",
          processId: 100,
          startedAt: "2026-10-05T23:00:00.000Z",
          workstreamReplication: { status: "pending" },
        });
      const pending = attempt < 420;
      return snapshot(pending ? Math.floor(attempt / 10) * 10 : attempt, {
        status: pending ? "starting" : "ready",
        startedAt: "2026-10-06T00:00:10.000Z",
        workstreamReplication: pending ? { status: "pending" } : { status: "ready" },
      });
    }, undefined);
    expect(result).toMatchObject({ status: "ready", processId: 200 });
    expect(reads).toBe(422);
    // With the predecessor known from the baseline, a clock that stepped back so the
    // replacement seems to have started before the service operation changes nothing.
    const stepped = await observe(
      (attempt) => {
        if (attempt <= 20)
          return snapshot(attempt, {
            status: "starting",
            processId: 100,
            startedAt: "2026-10-05T23:00:00.000Z",
            workstreamReplication: { status: "pending" },
          });
        const pending = attempt < 420;
        return snapshot(pending ? Math.floor(attempt / 10) * 10 : attempt, {
          status: pending ? "starting" : "ready",
          startedAt: "2026-10-05T23:59:50.000Z",
          workstreamReplication: pending ? { status: "pending" } : { status: "ready" },
        });
      },
      {
        status: "observed",
        processId: 100,
        startedAt: "2026-10-05T23:00:00.000Z",
        components: {
          sync: { status: "ready" },
          workstreamReplication: { status: "pending" },
          workspaceCoordination: { status: "disabled" },
          remoteControl: { status: "ready" },
          conversation: { status: "disabled" },
          supervision: { status: "disabled" },
        },
      },
    );
    expect(stepped.result).toMatchObject({ status: "ready", processId: 200 });
  });

  it("stops counting liveness once the replacement restarts and caps a live startup", async () => {
    const pending = {
      status: "starting" as const,
      workstreamReplication: { status: "pending" as const },
    };
    const restarted = await observe(
      (attempt) =>
        snapshot(Math.floor(attempt / 10) * 10, {
          ...pending,
          ...(attempt > 100 ? { processId: 201, startedAt: "2026-10-06T00:00:50.000Z" } : {}),
        }),
      undefined,
    ).catch((error: unknown) => error);
    expect(restarted).toMatchObject({
      code: "node_fleet_readiness_timeout",
      details: { readiness: { observations: 219, lastProcessId: 201 } },
    });
    const neverReady = await observe(
      (attempt) => snapshot(Math.floor(attempt / 10) * 10, pending),
      undefined,
    ).catch((error: unknown) => error);
    expect(neverReady).toMatchObject({
      code: "node_fleet_readiness_timeout",
      details: { readiness: { observations: 1_200, lastStatus: "starting" } },
    });
  });

  it("fails sixty seconds after the last progress and reports a missing fresh snapshot", async () => {
    // A hung process: its `starting` snapshot stays fresh but `updatedAt` never advances.
    const stuck = await observe(
      () => snapshot(1, { status: "starting", workstreamReplication: { status: "pending" } }),
      undefined,
    ).catch((error: unknown) => error);
    expect(stuck).toMatchObject({
      code: "node_fleet_readiness_timeout",
      details: { readiness: { observations: 120, lastStatus: "starting" } },
    });
    const silent = await observe(() => snapshot(-1, { processId: 100 }), undefined).catch(
      (error: unknown) => error,
    );
    expect(silent).toMatchObject({
      code: "node_fleet_readiness_timeout",
      message: "The Node runtime did not publish a fresh readiness snapshot within 60 seconds.",
      details: { readiness: { lastProcessId: null, blockers: [] } },
    });
  });

  it("captures no baseline from an unreadable or stale predecessor snapshot", async () => {
    await expect(
      captureNodeFleetReadinessBaseline(
        "/fixture/node-runtime-health.json",
        {
          readHealth: async () => {
            throw new Error("missing");
          },
        },
        notBefore,
      ),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      captureNodeFleetReadinessBaseline(
        "/fixture/node-runtime-health.json",
        { readHealth: async () => snapshot(-241) },
        notBefore,
      ),
    ).resolves.toEqual({ status: "stale" });
  });
});

describe("Node fleet failure recovery", () => {
  const readinessFailure = (): NodeFleetApplyError =>
    new NodeFleetApplyError(
      "node_fleet_readiness_timeout",
      "The Node runtime did not become ready: supervision=unavailable:supervision_attention_required (baseline ready).",
      {
        details: {
          readiness: {
            baseline: "observed",
            blockers: [
              {
                component: "supervision",
                observed: "unavailable:supervision_attention_required",
                baseline: "ready",
              },
            ],
            lastStatus: "degraded",
            lastProcessId: 200,
            observations: 120,
          },
        },
      },
    );

  it("keeps the readiness failure and marks a restored predecessor", async () => {
    const failure = readinessFailure();
    await recoverNodeFleetFailure(failure, async () => undefined, "Node onboarding");
    expect(failure.code).toBe("node_fleet_readiness_timeout");
    expect(failure.details.recovery).toBe("restored");
  });

  it("names the blocking component when recovery cannot restore the predecessor", async () => {
    const recoveryError = Object.assign(new Error("rollback failed"), {
      code: "service_rollback_unproven",
    });
    const failure = await recoverNodeFleetFailure(
      readinessFailure(),
      async () => {
        throw recoveryError;
      },
      "Node onboarding",
    ).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(NodeFleetApplyError);
    expect(failure).toMatchObject({
      code: "node_fleet_recovery_failed",
      message:
        "Node onboarding failed (node_fleet_readiness_timeout: The Node runtime did not become ready: supervision=unavailable:supervision_attention_required (baseline ready).) and the prior service state could not be restored (service_rollback_unproven).",
      cause: recoveryError,
      details: {
        failedCode: "node_fleet_readiness_timeout",
        recovery: "failed",
        recoveryFailureCode: "service_rollback_unproven",
        readiness: { blockers: [{ component: "supervision" }] },
      },
    });
    const repeated = (failure as NodeFleetApplyError).details;
    await recoverNodeFleetFailure(failure, async () => undefined, "Node onboarding");
    expect((failure as NodeFleetApplyError).details).toBe(repeated);
    expect(repeated.recovery).toBe("failed");
  });
});
