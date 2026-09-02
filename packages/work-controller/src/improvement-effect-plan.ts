import type {
  ImprovementEffectBlockedReasonV1,
  ImprovementEffectComparisonPlanV1,
  ImprovementEffectObservationRequestV1,
  ImprovementEffectSourceObservationV1,
  ImprovementEvaluationProtocolPlanV1,
  ImprovementEvaluationProtocolRequestV1,
  ImprovementMetricComparisonStatusV1,
  ImprovementMetricComparisonV1,
  ImprovementMetricIdV1,
  ImprovementProtocolBlockedReasonV1,
  ImprovementProtocolSourceObservationV1,
} from "@lervo/application-contract";

import {
  improvementEffectDigest,
  improvementEffectId,
  orderedImprovementObservations,
  validateImprovementEffectRequest,
  validateImprovementEffectSource,
  validateImprovementProtocolRequest,
  validateImprovementProtocolSource,
} from "./improvement-effect-validation.js";

const metricPolicy: Record<
  ImprovementMetricIdV1,
  { direction: "higher" | "lower"; materialDifferenceBasisPoints: number }
> = {
  source_recall: { direction: "higher", materialDifferenceBasisPoints: 500 },
  unnecessary_context: { direction: "lower", materialDifferenceBasisPoints: 500 },
  verification_success: { direction: "higher", materialDifferenceBasisPoints: 500 },
  repeated_failure: { direction: "lower", materialDifferenceBasisPoints: 300 },
  rework: { direction: "lower", materialDifferenceBasisPoints: 300 },
  user_correction: { direction: "lower", materialDifferenceBasisPoints: 300 },
};

export function createImprovementEvaluationProtocolPlan(input: {
  request: ImprovementEvaluationProtocolRequestV1;
  source: ImprovementProtocolSourceObservationV1;
}): ImprovementEvaluationProtocolPlanV1 {
  validateImprovementProtocolRequest(input.request);
  validateImprovementProtocolSource(input.source);
  const { request, source } = input;
  const blocked = new Set<ImprovementProtocolBlockedReasonV1>();
  if (source.patternId !== request.patternId) blocked.add("source_mismatch");
  if (source.observedAt !== request.registeredAt) blocked.add("source_mismatch");
  if (source.patternState !== "reviewed") blocked.add("pattern_not_reviewed");
  if (source.candidateContentHash !== request.candidateContentHash)
    blocked.add("candidate_mismatch");
  if (source.reviewContentHash !== request.reviewContentHash) blocked.add("review_mismatch");
  if (source.targetContentHash !== request.targetContentHash) blocked.add("target_mismatch");
  if (request.adapter.availability !== "available") blocked.add("adapter_unavailable");
  if (Date.parse(request.baselineWindow.endedAt) > Date.parse(request.registeredAt))
    blocked.add("baseline_after_registration");
  const baseline = orderedImprovementObservations(request.baseline);
  const protocolMaterial = {
    projectId: source.projectId,
    patternId: request.patternId,
    candidateContentHash: request.candidateContentHash,
    reviewContentHash: request.reviewContentHash,
    targetContentHash: request.targetContentHash,
    requestDigest: request.requestDigest,
    adapterDescriptorHash: request.adapter.descriptorHash,
    baselineWindow: request.baselineWindow,
    baseline,
    registeredAt: request.registeredAt,
  };
  const protocolId = improvementEffectId("ieprotocol", protocolMaterial);
  const content = {
    schemaVersion: 1 as const,
    protocolId,
    status: blocked.size === 0 ? ("ready" as const) : ("blocked" as const),
    projectId: source.projectId,
    patternId: request.patternId,
    candidateContentHash: request.candidateContentHash,
    reviewContentHash: request.reviewContentHash,
    targetContentHash: request.targetContentHash,
    requestDigest: request.requestDigest,
    adapterId: request.adapter.adapterId,
    adapterVersion: request.adapter.adapterVersion,
    adapterDescriptorHash: request.adapter.descriptorHash,
    baselineWindowHash: improvementEffectDigest(request.baselineWindow),
    baselineObservationHash: improvementEffectDigest(baseline),
    metricIds: baseline.map((item) => item.metricId),
    registeredAt: request.registeredAt,
    blockedReasons: [...blocked].sort(),
  };
  return { ...content, planId: improvementEffectId("ieplan", content) };
}

function basisPoints(numerator: number, denominator: number): number {
  return Math.round((numerator * 10_000) / denominator);
}

function compareMetric(
  baseline: ImprovementEvaluationProtocolRequestV1["baseline"][number],
  treatment: ImprovementEffectObservationRequestV1["treatment"][number],
): ImprovementMetricComparisonV1 {
  const baselineBasisPoints = basisPoints(baseline.numerator, baseline.denominator);
  const treatmentBasisPoints = basisPoints(treatment.numerator, treatment.denominator);
  const signedDeltaBasisPoints = treatmentBasisPoints - baselineBasisPoints;
  const policy = metricPolicy[baseline.metricId];
  let status: ImprovementMetricComparisonStatusV1 = "no_material_difference";
  if (baseline.denominator < 10 || treatment.denominator < 10) status = "insufficient_evidence";
  else if (Math.abs(signedDeltaBasisPoints) >= policy.materialDifferenceBasisPoints) {
    const favorable =
      policy.direction === "higher" ? signedDeltaBasisPoints > 0 : signedDeltaBasisPoints < 0;
    status = favorable ? "favorable_observation" : "unfavorable_observation";
  }
  return {
    metricId: baseline.metricId,
    baselineBasisPoints,
    treatmentBasisPoints,
    signedDeltaBasisPoints,
    favorableDirection: policy.direction,
    materialDifferenceBasisPoints: policy.materialDifferenceBasisPoints,
    status,
  };
}

function overall(comparisons: ImprovementMetricComparisonV1[]) {
  if (comparisons.some((item) => item.status === "unfavorable_observation"))
    return "mixed_or_unfavorable_observation" as const;
  if (comparisons.some((item) => item.status === "insufficient_evidence"))
    return "inconclusive" as const;
  if (comparisons.some((item) => item.status === "favorable_observation"))
    return "favorable_observation" as const;
  return "no_material_difference" as const;
}

export function createImprovementEffectComparisonPlan(input: {
  request: ImprovementEffectObservationRequestV1;
  source: ImprovementEffectSourceObservationV1;
}): ImprovementEffectComparisonPlanV1 {
  validateImprovementEffectRequest(input.request);
  validateImprovementEffectSource(input.source);
  const { request, source } = input;
  const blocked = new Set<ImprovementEffectBlockedReasonV1>();
  const expectedProtocol = createImprovementEvaluationProtocolPlan({
    request: source.protocol,
    source: {
      projectId: source.projectId,
      patternId: source.protocol.patternId,
      patternState: "reviewed",
      candidateContentHash: source.protocol.candidateContentHash,
      reviewContentHash: source.protocol.reviewContentHash,
      targetContentHash: source.protocol.targetContentHash,
      observedAt: source.registeredAt,
    },
  });
  if (expectedProtocol.protocolId !== request.protocolId) blocked.add("protocol_mismatch");
  if (expectedProtocol.planId !== source.protocolPlanId) blocked.add("protocol_mismatch");
  if (source.registeredAt !== source.protocol.registeredAt) blocked.add("protocol_mismatch");
  if (request.patternId !== source.protocol.patternId) blocked.add("pattern_mismatch");
  if (
    request.adapter.adapterId !== source.protocol.adapter.adapterId ||
    request.adapter.adapterVersion !== source.protocol.adapter.adapterVersion ||
    request.adapter.descriptorHash !== source.protocol.adapter.descriptorHash
  )
    blocked.add("adapter_mismatch");
  if (request.adapter.availability !== "available") blocked.add("adapter_unavailable");
  if (source.currentPatternState !== "promoted") blocked.add("pattern_not_promoted");
  if (Date.parse(source.registeredAt) > Date.parse(source.promotedAt))
    blocked.add("promotion_before_registration");
  if (Date.parse(request.treatmentWindow.startedAt) < Date.parse(source.promotedAt))
    blocked.add("treatment_before_promotion");
  if (Date.parse(request.treatmentWindow.endedAt) > Date.parse(request.observedAt))
    blocked.add("treatment_after_observation");
  if (source.currentTargetContentHash !== source.protocol.targetContentHash)
    blocked.add("target_changed");
  const baseline = orderedImprovementObservations(source.protocol.baseline);
  const treatment = orderedImprovementObservations(request.treatment);
  if (
    baseline.map((item) => item.metricId).join("|") !==
    treatment.map((item) => item.metricId).join("|")
  )
    blocked.add("metric_set_mismatch");
  const comparisons = blocked.has("metric_set_mismatch")
    ? []
    : baseline.map((item, index) => compareMetric(item, treatment[index]!));
  const result = overall(comparisons);
  const comparisonMaterial = {
    projectId: source.projectId,
    protocolId: request.protocolId,
    protocolPlanId: source.protocolPlanId,
    promotionEventId: source.promotionEventId,
    requestDigest: request.requestDigest,
    treatmentWindow: request.treatmentWindow,
    treatment,
  };
  const comparisonId = improvementEffectId("iecomparison", comparisonMaterial);
  const content = {
    schemaVersion: 1 as const,
    comparisonId,
    status: blocked.size === 0 ? ("ready" as const) : ("blocked" as const),
    projectId: source.projectId,
    protocolId: request.protocolId,
    protocolPlanId: source.protocolPlanId,
    patternId: request.patternId,
    registrationEventId: source.registrationEventId,
    promotionEventId: source.promotionEventId,
    targetContentHash: source.protocol.targetContentHash,
    requestDigest: request.requestDigest,
    adapterId: request.adapter.adapterId,
    adapterVersion: request.adapter.adapterVersion,
    adapterDescriptorHash: request.adapter.descriptorHash,
    treatmentWindowHash: improvementEffectDigest(request.treatmentWindow),
    treatmentObservationHash: improvementEffectDigest(treatment),
    comparisons,
    overall: result,
    attribution: "unestablished" as const,
    rollbackDisposition:
      result === "mixed_or_unfavorable_observation"
        ? ("review_required" as const)
        : ("not_authorized" as const),
    observedAt: request.observedAt,
    blockedReasons: [...blocked].sort(),
  };
  return { ...content, planId: improvementEffectId("ieplan", content) };
}

export { improvementEffectDigest } from "./improvement-effect-validation.js";
