import type {
  ImprovementEffectObservationRequestV1,
  ImprovementEffectSourceObservationV1,
  ImprovementEvaluationProtocolRequestV1,
  ImprovementMetricIdV1,
  ImprovementProtocolSourceObservationV1,
} from "@lervo/application-contract";
import { describe, expect, it } from "vitest";

import {
  createImprovementEffectComparisonPlan,
  createImprovementEvaluationProtocolPlan,
} from "../src/index.js";

const hash = (value: string) => `sha256:${value.repeat(64)}`;
const patternId = "pattern_abcdefabcdefabcdefabcdef";

function observation(metricId: ImprovementMetricIdV1, numerator: number, denominator = 100) {
  return {
    metricId,
    numerator,
    denominator,
    evidenceSetHash: hash(metricId === "source_recall" ? "a" : "b"),
    observationReceiptHash: hash(metricId === "source_recall" ? "c" : "d"),
  };
}

function protocolFixture(): {
  request: ImprovementEvaluationProtocolRequestV1;
  source: ImprovementProtocolSourceObservationV1;
} {
  const request: ImprovementEvaluationProtocolRequestV1 = {
    schemaVersion: 1,
    patternId,
    candidateContentHash: hash("1"),
    reviewContentHash: hash("2"),
    targetContentHash: hash("3"),
    requestDigest: hash("4"),
    adapter: {
      schemaVersion: 1,
      adapterId: "iobs_repository_metrics",
      adapterVersion: "1.0.0",
      descriptorHash: hash("5"),
      availability: "available",
      authentication: "adapter_verified",
      rawEvidence: "adapter_private",
      capabilities: ["rate_observation.verify"],
    },
    baselineWindow: {
      startedAt: "2026-08-01T00:00:00.000Z",
      endedAt: "2026-08-31T23:59:59.000Z",
    },
    baseline: [observation("verification_success", 70), observation("rework", 20)],
    registeredAt: "2026-09-01T00:00:00.000Z",
  };
  return {
    request,
    source: {
      projectId: "prj_abcdefabcdefabcd",
      patternId,
      patternState: "reviewed",
      candidateContentHash: request.candidateContentHash,
      reviewContentHash: request.reviewContentHash,
      targetContentHash: request.targetContentHash,
      observedAt: request.registeredAt,
    },
  };
}

function effectFixture(): {
  request: ImprovementEffectObservationRequestV1;
  source: ImprovementEffectSourceObservationV1;
} {
  const fixture = protocolFixture();
  const plan = createImprovementEvaluationProtocolPlan(fixture);
  return {
    request: {
      schemaVersion: 1,
      protocolId: plan.protocolId,
      patternId,
      requestDigest: hash("6"),
      adapter: { ...fixture.request.adapter, capabilities: ["rate_observation.verify"] },
      treatmentWindow: {
        startedAt: "2026-09-02T00:00:00.000Z",
        endedAt: "2026-09-30T23:59:59.000Z",
      },
      treatment: [observation("rework", 10), observation("verification_success", 80)],
      observedAt: "2026-10-01T00:00:00.000Z",
    },
    source: {
      projectId: fixture.source.projectId,
      protocol: fixture.request,
      protocolPlanId: plan.planId,
      registrationEventId: "evt_protocol_registration_01",
      registeredAt: fixture.request.registeredAt,
      promotionEventId: "evt_pattern_promotion_01",
      promotedAt: "2026-09-01T12:00:00.000Z",
      currentPatternState: "promoted",
      currentTargetContentHash: fixture.request.targetContentHash,
    },
  };
}

describe("verified improvement effect planning", () => {
  it("pre-registers an exact baseline before promotion without content bodies", () => {
    const fixture = protocolFixture();
    const first = createImprovementEvaluationProtocolPlan(fixture);
    const second = createImprovementEvaluationProtocolPlan(fixture);
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      status: "ready",
      metricIds: ["rework", "verification_success"],
      blockedReasons: [],
    });
    expect(JSON.stringify(first)).not.toContain(hash("c"));
  });

  it("blocks a late baseline, unreviewed pattern, stale target, and unavailable adapter distinctly", () => {
    const fixture = protocolFixture();
    fixture.request.baselineWindow.endedAt = "2026-09-02T00:00:00.000Z";
    fixture.request.adapter.availability = "unavailable";
    fixture.source.patternState = "candidate";
    fixture.source.targetContentHash = hash("9");
    expect(createImprovementEvaluationProtocolPlan(fixture)).toMatchObject({
      status: "blocked",
      blockedReasons: [
        "adapter_unavailable",
        "baseline_after_registration",
        "pattern_not_reviewed",
        "target_mismatch",
      ],
    });
  });

  it("reports favorable observations while keeping attribution and rollback unclaimed", () => {
    const result = createImprovementEffectComparisonPlan(effectFixture());
    expect(result).toMatchObject({
      status: "ready",
      overall: "favorable_observation",
      attribution: "unestablished",
      rollbackDisposition: "not_authorized",
      comparisons: [
        { metricId: "rework", status: "favorable_observation", signedDeltaBasisPoints: -1000 },
        {
          metricId: "verification_success",
          status: "favorable_observation",
          signedDeltaBasisPoints: 1000,
        },
      ],
    });
  });

  it("requires review rather than automatic rollback for an unfavorable observation", () => {
    const fixture = effectFixture();
    fixture.request.treatment = [
      observation("rework", 35),
      observation("verification_success", 80),
    ];
    expect(createImprovementEffectComparisonPlan(fixture)).toMatchObject({
      overall: "mixed_or_unfavorable_observation",
      attribution: "unestablished",
      rollbackDisposition: "review_required",
    });
  });

  it("keeps insufficient samples and no material difference separate", () => {
    const fixture = effectFixture();
    fixture.source.protocol.baseline = [
      observation("rework", 1, 5),
      observation("verification_success", 70),
    ];
    const protocolPlan = createImprovementEvaluationProtocolPlan({
      request: fixture.source.protocol,
      source: {
        ...protocolFixture().source,
        targetContentHash: fixture.source.protocol.targetContentHash,
      },
    });
    fixture.request.protocolId = protocolPlan.protocolId;
    fixture.source.protocolPlanId = protocolPlan.planId;
    fixture.request.treatment = [
      observation("rework", 1, 5),
      observation("verification_success", 72),
    ];
    expect(createImprovementEffectComparisonPlan(fixture)).toMatchObject({
      overall: "inconclusive",
      comparisons: [
        { metricId: "rework", status: "insufficient_evidence" },
        { metricId: "verification_success", status: "no_material_difference" },
      ],
    });
  });

  it("blocks promotion timing, target drift, adapter drift, and metric drift", () => {
    const fixture = effectFixture();
    fixture.source.promotedAt = "2026-08-31T00:00:00.000Z";
    fixture.source.currentTargetContentHash = hash("8");
    fixture.request.adapter.descriptorHash = hash("7");
    fixture.request.treatment = [observation("verification_success", 80)];
    expect(createImprovementEffectComparisonPlan(fixture)).toMatchObject({
      status: "blocked",
      blockedReasons: [
        "adapter_mismatch",
        "metric_set_mismatch",
        "promotion_before_registration",
        "target_changed",
      ],
      comparisons: [],
      attribution: "unestablished",
      rollbackDisposition: "not_authorized",
    });
  });
});
