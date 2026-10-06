import { describe, expect, it } from "vitest";

import type { NodeRuntimeHealthSnapshot } from "@lervo/node-runtime";

import {
  evaluateNodeReadiness,
  nodeReadinessBaselineFrom,
  nodeRuntimeHasOnlyAuxiliaryConditions,
} from "../src/node-fleet-readiness-policy.js";

const supervisionAttention = {
  status: "unavailable" as const,
  failureCode: "supervision_attention_required",
  reasonCodes: ["preflight_repair_requires_review"],
};

function snapshot(overrides: Partial<NodeRuntimeHealthSnapshot> = {}): NodeRuntimeHealthSnapshot {
  return {
    schemaVersion: 1,
    status: "ready",
    processId: 200,
    startedAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:01.000Z",
    sync: { status: "ready" },
    workstreamReplication: { status: "ready" },
    workspaceCoordination: { status: "disabled" },
    remoteControl: { status: "ready" },
    ...overrides,
  };
}

describe("Node readiness regression policy", () => {
  it("carries an unchanged supervision attention over from the predecessor and reports it", () => {
    const baseline = nodeReadinessBaselineFrom(
      snapshot({ processId: 100, status: "degraded", supervision: supervisionAttention }),
    );
    const evaluation = evaluateNodeReadiness(
      snapshot({ status: "degraded", supervision: supervisionAttention }),
      baseline,
      false,
    );
    expect(evaluation).toEqual({
      complete: true,
      offline: false,
      acceptedCount: 6,
      carried: [
        {
          component: "supervision",
          status: "unavailable",
          failureCode: "supervision_attention_required",
          reasonCodes: ["preflight_repair_requires_review"],
        },
      ],
      blockers: [],
    });
  });

  it("rejects a component that newly fails or changes its failure code", () => {
    const readyBaseline = nodeReadinessBaselineFrom(snapshot({ supervision: { status: "ready" } }));
    expect(
      evaluateNodeReadiness(
        snapshot({ status: "degraded", supervision: supervisionAttention }),
        readyBaseline,
        false,
      ),
    ).toMatchObject({
      complete: false,
      blockers: [
        {
          component: "supervision",
          observed: "unavailable:supervision_attention_required",
          baseline: "ready",
        },
      ],
    });
    const changedBaseline = nodeReadinessBaselineFrom(
      snapshot({
        status: "degraded",
        conversation: { status: "unavailable", failureCode: "response_storage_unavailable" },
      }),
    );
    expect(
      evaluateNodeReadiness(
        snapshot({
          status: "degraded",
          conversation: { status: "unavailable", failureCode: "response_provider_unavailable" },
        }),
        changedBaseline,
        false,
      ).blockers,
    ).toEqual([
      {
        component: "conversation",
        observed: "unavailable:response_provider_unavailable",
        baseline: "unavailable:response_storage_unavailable",
      },
    ]);
  });

  it("never carries a delivery component and carries nothing without an observed baseline", () => {
    const divergent = {
      status: "unavailable" as const,
      failureCode: "divergent_heads",
    };
    const baseline = nodeReadinessBaselineFrom(
      snapshot({ status: "degraded", workstreamReplication: divergent }),
    );
    expect(
      evaluateNodeReadiness(
        snapshot({ status: "degraded", workstreamReplication: divergent }),
        baseline,
        false,
      ).blockers,
    ).toEqual([
      {
        component: "workstreamReplication",
        observed: "unavailable:divergent_heads",
        baseline: "unavailable:divergent_heads",
      },
    ]);
    for (const status of ["not_applicable", "unavailable", "stale"] as const) {
      expect(
        evaluateNodeReadiness(
          snapshot({ status: "degraded", supervision: supervisionAttention }),
          { status },
          false,
        ).blockers,
      ).toEqual([
        {
          component: "supervision",
          observed: "unavailable:supervision_attention_required",
          baseline: null,
        },
      ]);
    }
  });

  it("keeps pending components and a starting process from completing", () => {
    const evaluation = evaluateNodeReadiness(
      snapshot({ status: "starting", sync: { status: "pending" } }),
      { status: "not_applicable" },
      false,
    );
    expect(evaluation.complete).toBe(false);
    expect(evaluation.acceptedCount).toBe(5);
    expect(evaluation.blockers).toEqual([
      { component: "sync", observed: "pending", baseline: null },
    ]);
  });

  it("accepts exact Hub unavailability only when the replacement allows it", () => {
    const offline = snapshot({
      status: "degraded",
      sync: { status: "unavailable", failureCode: "hub_unavailable" },
    });
    expect(evaluateNodeReadiness(offline, { status: "not_applicable" }, true)).toMatchObject({
      complete: true,
      offline: true,
    });
    expect(evaluateNodeReadiness(offline, { status: "not_applicable" }, false)).toMatchObject({
      complete: false,
      offline: false,
    });
  });

  it("identifies a deployed runtime whose only non-ready conditions are auxiliary", () => {
    const runtime = {
      status: "degraded",
      sync: "ready",
      workstreamReplication: "ready",
      workspaceCoordination: "disabled",
      remoteControl: "ready",
      conversation: "ready",
      supervision: "unavailable:supervision_attention_required",
    };
    expect(nodeRuntimeHasOnlyAuxiliaryConditions(runtime)).toBe(true);
    expect(
      nodeRuntimeHasOnlyAuxiliaryConditions({ ...runtime, sync: "unavailable:divergent_heads" }),
    ).toBe(false);
    expect(nodeRuntimeHasOnlyAuxiliaryConditions({ ...runtime, conversation: "pending" })).toBe(
      false,
    );
    expect(nodeRuntimeHasOnlyAuxiliaryConditions({ ...runtime, status: "stale" })).toBe(false);
    expect(nodeRuntimeHasOnlyAuxiliaryConditions({ ...runtime, supervision: "ready" })).toBe(false);
  });
});
