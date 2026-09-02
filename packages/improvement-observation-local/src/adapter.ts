import {
  ImprovementObservationPortError,
  type ImprovementMetricIdV1,
  type ImprovementMetricObservationV1,
  type ImprovementObservationAdapterDescriptorV1,
  type ImprovementObservationCollectionRequestV1,
  type ImprovementObservationCollectorV1,
  type ImprovementObservationPortV1,
} from "@lervo/application-contract";

import { observationDigest, stableObservationJson } from "./digest.js";
import type { LocalImprovementEvidenceSourceV1 } from "./types.js";
import { projectVerificationSuccess } from "./verification-success.js";

export const LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID = "iobs_lervo_local_events";
const ADAPTER_VERSION = "1.0.0";
const PATTERN_ID = /^pattern_[a-f0-9]{24}$/u;
const SUPPORTED_METRICS = new Set<ImprovementMetricIdV1>(["verification_success"]);

export type LocalImprovementObservationAdapterV1 = ImprovementObservationPortV1 &
  ImprovementObservationCollectorV1;

function descriptor(adapterId: string): ImprovementObservationAdapterDescriptorV1 {
  const descriptorHash = observationDigest({
    schemaVersion: 1,
    adapterId,
    adapterVersion: ADAPTER_VERSION,
    evidenceSource: "lervo_local_canonical_events",
    metricPolicies: [
      {
        metricId: "verification_success",
        denominator: "verification.completed events",
        numerator: "verification.completed events with status passed",
        windowBoundary: "inclusive",
      },
    ],
    receiptBinding: "phase_pattern_window_metric_counts_evidence",
  });
  return {
    schemaVersion: 1,
    adapterId,
    adapterVersion: ADAPTER_VERSION,
    descriptorHash,
    availability: "available",
    authentication: "adapter_verified",
    rawEvidence: "adapter_private",
    capabilities: ["rate_observation.verify"],
  };
}

function validateCollectionRequest(input: ImprovementObservationCollectionRequestV1): void {
  const startedAt = Date.parse(input.window.startedAt);
  const endedAt = Date.parse(input.window.endedAt);
  if (
    !["baseline", "treatment"].includes(input.phase) ||
    !PATTERN_ID.test(input.patternId) ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(endedAt) ||
    startedAt > endedAt ||
    input.metricIds.length === 0 ||
    input.metricIds.length > 6 ||
    new Set(input.metricIds).size !== input.metricIds.length
  )
    throw new ImprovementObservationPortError(
      "request_invalid",
      "The local improvement observation request is invalid.",
    );
}

function receiptHash(input: {
  adapterDescriptorHash: string;
  request: ImprovementObservationCollectionRequestV1;
  observation: Omit<ImprovementMetricObservationV1, "observationReceiptHash">;
}): string {
  return observationDigest({
    schemaVersion: 1,
    adapterDescriptorHash: input.adapterDescriptorHash,
    phase: input.request.phase,
    patternId: input.request.patternId,
    window: input.request.window,
    observation: input.observation,
  });
}

export function createLocalImprovementObservationAdapter(input: {
  evidenceSource: LocalImprovementEvidenceSourceV1;
  adapterId?: string;
}): LocalImprovementObservationAdapterV1 {
  const adapterId = input.adapterId ?? LOCAL_IMPROVEMENT_OBSERVATION_ADAPTER_ID;
  if (!/^iobs_[A-Za-z0-9_-]{1,122}$/u.test(adapterId))
    throw new TypeError("The local improvement observation adapter ID is invalid.");
  const adapterDescriptor = descriptor(adapterId);
  const collect: ImprovementObservationCollectorV1["collect"] = async (request) => {
    validateCollectionRequest(request);
    const unsupported = request.metricIds
      .filter((metricId) => !SUPPORTED_METRICS.has(metricId))
      .sort()
      .map((metricId) => ({ metricId, reason: "metric_unsupported" as const }));
    if (!request.metricIds.includes("verification_success"))
      return { observations: [], unavailable: unsupported };
    let snapshot;
    try {
      snapshot = await input.evidenceSource.readWindow(request.window);
    } catch (error) {
      if (error instanceof ImprovementObservationPortError) {
        if (error.code === "evidence_limit_exceeded")
          return {
            observations: [],
            unavailable: [
              { metricId: "verification_success", reason: "evidence_limit_exceeded" },
              ...unsupported,
            ],
          };
        throw error;
      }
      throw new ImprovementObservationPortError(
        "evidence_unavailable",
        "The local improvement observation source failed.",
        { cause: error },
      );
    }
    const projected = projectVerificationSuccess(snapshot, request.window);
    if (projected === null)
      return {
        observations: [],
        unavailable: [
          { metricId: "verification_success", reason: "no_eligible_evidence" },
          ...unsupported,
        ],
      };
    const observationWithoutReceipt = {
      metricId: "verification_success" as const,
      numerator: projected.numerator,
      denominator: projected.denominator,
      evidenceSetHash: projected.evidenceSetHash,
    };
    return {
      observations: [
        {
          ...observationWithoutReceipt,
          observationReceiptHash: receiptHash({
            adapterDescriptorHash: adapterDescriptor.descriptorHash,
            request,
            observation: observationWithoutReceipt,
          }),
        },
      ],
      unavailable: unsupported,
    };
  };
  return {
    inspect: async (requestedAdapterId) => {
      if (requestedAdapterId !== adapterId)
        throw new ImprovementObservationPortError(
          "adapter_not_found",
          "The requested local improvement observation adapter is not configured.",
        );
      return structuredClone(adapterDescriptor);
    },
    collect,
    verify: async (request) => {
      if (request.observations.some((item) => !SUPPORTED_METRICS.has(item.metricId)))
        throw new ImprovementObservationPortError(
          "metric_unsupported",
          "The claimed improvement metric is not supported by this adapter.",
        );
      const collected = await collect({
        phase: request.phase,
        patternId: request.patternId,
        window: request.window,
        metricIds: request.observations.map((item) => item.metricId),
      });
      if (collected.unavailable.length > 0) {
        const capacityExceeded = collected.unavailable.some(
          (item) => item.reason === "evidence_limit_exceeded",
        );
        throw new ImprovementObservationPortError(
          capacityExceeded ? "evidence_limit_exceeded" : "evidence_unavailable",
          "The claimed improvement observation cannot be re-observed.",
        );
      }
      if (
        stableObservationJson(collected.observations) !==
        stableObservationJson(request.observations)
      )
        throw new ImprovementObservationPortError(
          "observation_mismatch",
          "The claimed improvement observation differs from local event evidence.",
        );
      return structuredClone(collected.observations);
    },
  };
}
