export type ImprovementMetricIdV1 =
  | "source_recall"
  | "unnecessary_context"
  | "verification_success"
  | "repeated_failure"
  | "rework"
  | "user_correction";

export interface ImprovementObservationAdapterDescriptorV1 {
  schemaVersion: 1;
  adapterId: string;
  adapterVersion: string;
  descriptorHash: string;
  availability: "available" | "unavailable";
  authentication: "adapter_verified";
  rawEvidence: "adapter_private";
  capabilities: ["rate_observation.verify"];
}

export interface ImprovementMetricObservationV1 {
  metricId: ImprovementMetricIdV1;
  numerator: number;
  denominator: number;
  evidenceSetHash: string;
  observationReceiptHash: string;
}

export interface ImprovementObservationWindowV1 {
  startedAt: string;
  endedAt: string;
}

export interface ImprovementEvaluationProtocolRequestV1 {
  schemaVersion: 1;
  patternId: string;
  candidateContentHash: string;
  reviewContentHash: string;
  targetContentHash: string;
  requestDigest: string;
  adapter: ImprovementObservationAdapterDescriptorV1;
  baselineWindow: ImprovementObservationWindowV1;
  baseline: ImprovementMetricObservationV1[];
  registeredAt: string;
}

export interface ImprovementProtocolSourceObservationV1 {
  projectId: string;
  patternId: string;
  patternState: string;
  candidateContentHash: string | null;
  reviewContentHash: string | null;
  targetContentHash: string;
  observedAt: string;
}

export type ImprovementProtocolBlockedReasonV1 =
  | "adapter_unavailable"
  | "baseline_after_registration"
  | "candidate_mismatch"
  | "pattern_not_reviewed"
  | "review_mismatch"
  | "source_mismatch"
  | "target_mismatch";

export interface ImprovementEvaluationProtocolPlanV1 {
  schemaVersion: 1;
  planId: string;
  protocolId: string;
  status: "ready" | "blocked";
  projectId: string;
  patternId: string;
  candidateContentHash: string;
  reviewContentHash: string;
  targetContentHash: string;
  requestDigest: string;
  adapterId: string;
  adapterVersion: string;
  adapterDescriptorHash: string;
  baselineWindowHash: string;
  baselineObservationHash: string;
  metricIds: ImprovementMetricIdV1[];
  registeredAt: string;
  blockedReasons: ImprovementProtocolBlockedReasonV1[];
}

export interface ImprovementEffectObservationRequestV1 {
  schemaVersion: 1;
  protocolId: string;
  patternId: string;
  requestDigest: string;
  adapter: ImprovementObservationAdapterDescriptorV1;
  treatmentWindow: ImprovementObservationWindowV1;
  treatment: ImprovementMetricObservationV1[];
  observedAt: string;
}

export interface ImprovementEffectSourceObservationV1 {
  projectId: string;
  protocol: ImprovementEvaluationProtocolRequestV1;
  protocolPlanId: string;
  registrationEventId: string;
  registeredAt: string;
  promotionEventId: string;
  promotedAt: string;
  currentPatternState: string;
  currentTargetContentHash: string;
}

export type ImprovementEffectBlockedReasonV1 =
  | "adapter_mismatch"
  | "adapter_unavailable"
  | "metric_set_mismatch"
  | "pattern_mismatch"
  | "pattern_not_promoted"
  | "promotion_before_registration"
  | "protocol_mismatch"
  | "target_changed"
  | "treatment_after_observation"
  | "treatment_before_promotion";

export type ImprovementMetricComparisonStatusV1 =
  | "favorable_observation"
  | "unfavorable_observation"
  | "no_material_difference"
  | "insufficient_evidence";

export interface ImprovementMetricComparisonV1 {
  metricId: ImprovementMetricIdV1;
  baselineBasisPoints: number;
  treatmentBasisPoints: number;
  signedDeltaBasisPoints: number;
  favorableDirection: "higher" | "lower";
  materialDifferenceBasisPoints: number;
  status: ImprovementMetricComparisonStatusV1;
}

export interface ImprovementEffectComparisonPlanV1 {
  schemaVersion: 1;
  planId: string;
  comparisonId: string;
  status: "ready" | "blocked";
  projectId: string;
  protocolId: string;
  protocolPlanId: string;
  patternId: string;
  registrationEventId: string;
  promotionEventId: string;
  targetContentHash: string;
  requestDigest: string;
  adapterId: string;
  adapterVersion: string;
  adapterDescriptorHash: string;
  treatmentWindowHash: string;
  treatmentObservationHash: string;
  comparisons: ImprovementMetricComparisonV1[];
  overall:
    | "favorable_observation"
    | "mixed_or_unfavorable_observation"
    | "no_material_difference"
    | "inconclusive";
  attribution: "unestablished";
  rollbackDisposition: "not_authorized" | "review_required";
  observedAt: string;
  blockedReasons: ImprovementEffectBlockedReasonV1[];
}

export interface ImprovementObservationPortV1 {
  inspect(adapterId: string): Promise<ImprovementObservationAdapterDescriptorV1>;
  verify(input: {
    phase: "baseline" | "treatment";
    patternId: string;
    window: ImprovementObservationWindowV1;
    observations: ImprovementMetricObservationV1[];
  }): Promise<ImprovementMetricObservationV1[]>;
}
