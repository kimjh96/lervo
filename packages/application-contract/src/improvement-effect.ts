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

export interface ImprovementObservationPortV1 {
  inspect(adapterId: string): Promise<ImprovementObservationAdapterDescriptorV1>;
  verify(input: {
    phase: "baseline" | "treatment";
    patternId: string;
    window: ImprovementObservationWindowV1;
    observations: ImprovementMetricObservationV1[];
  }): Promise<ImprovementMetricObservationV1[]>;
}

export type ImprovementObservationUnavailableReasonV1 =
  "evidence_limit_exceeded" | "metric_unsupported" | "no_eligible_evidence";

export interface ImprovementObservationCollectionRequestV1 {
  phase: "baseline" | "treatment";
  patternId: string;
  window: ImprovementObservationWindowV1;
  metricIds: ImprovementMetricIdV1[];
}

export interface ImprovementObservationCollectionResultV1 {
  observations: ImprovementMetricObservationV1[];
  unavailable: Array<{
    metricId: ImprovementMetricIdV1;
    reason: ImprovementObservationUnavailableReasonV1;
  }>;
}

/** Optional collection for a host authorized to inspect an observation source. */
export interface ImprovementObservationCollectorV1 {
  collect(
    input: ImprovementObservationCollectionRequestV1,
  ): Promise<ImprovementObservationCollectionResultV1>;
}

export type ImprovementObservationPortErrorCodeV1 =
  | "adapter_not_found"
  | "evidence_invalid"
  | "evidence_limit_exceeded"
  | "evidence_unavailable"
  | "metric_unsupported"
  | "observation_mismatch"
  | "request_invalid";

export class ImprovementObservationPortError extends Error {
  constructor(
    readonly code: ImprovementObservationPortErrorCodeV1,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ImprovementObservationPortError";
  }
}
