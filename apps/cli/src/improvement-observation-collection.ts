import type {
  ImprovementMetricObservationV1,
  ImprovementObservationAdapterDescriptorV1,
  ImprovementObservationCollectionRequestV1,
  ImprovementObservationUnavailableReasonV1,
} from "@lervo/application-contract";

import type { LocalImprovementObservationHostV1 } from "./local-improvement-observation-host.js";

export type LocalImprovementObservationRequestDocumentV1 =
  ImprovementObservationCollectionRequestV1 & {
    schemaVersion: 1;
  };

export interface LocalImprovementObservationReportV1 {
  schemaVersion: 1;
  source: "local_repository_events";
  adapter: ImprovementObservationAdapterDescriptorV1;
  phase: ImprovementObservationCollectionRequestV1["phase"];
  patternId: string;
  window: ImprovementObservationCollectionRequestV1["window"];
  requestedMetricIds: ImprovementObservationCollectionRequestV1["metricIds"];
  observations: ImprovementMetricObservationV1[];
  unavailable: Array<{
    metricId: ImprovementObservationCollectionRequestV1["metricIds"][number];
    reason: ImprovementObservationUnavailableReasonV1;
  }>;
  attribution: "unestablished";
  canonicalMutation: "none";
}

export async function collectLocalImprovementObservations(input: {
  request: ImprovementObservationCollectionRequestV1;
  host: LocalImprovementObservationHostV1;
}): Promise<LocalImprovementObservationReportV1> {
  const [adapter, result] = await Promise.all([
    input.host.verifier.inspect(input.host.adapterId),
    input.host.collector.collect(input.request),
  ]);
  return {
    schemaVersion: 1,
    source: "local_repository_events",
    adapter,
    phase: input.request.phase,
    patternId: input.request.patternId,
    window: structuredClone(input.request.window),
    requestedMetricIds: [...input.request.metricIds],
    observations: result.observations,
    unavailable: result.unavailable,
    attribution: "unestablished",
    canonicalMutation: "none",
  };
}

export function parseLocalImprovementObservationRequest(
  value: unknown,
): ImprovementObservationCollectionRequestV1 {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value) ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1
  )
    throw new Error("The local improvement observation request must use schema version 1.");
  const { schemaVersion: _schemaVersion, ...request } =
    value as LocalImprovementObservationRequestDocumentV1;
  return request;
}
