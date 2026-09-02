import { createHash } from "node:crypto";

import type {
  ImprovementEffectObservationRequestV1,
  ImprovementEffectSourceObservationV1,
  ImprovementEvaluationProtocolRequestV1,
  ImprovementMetricIdV1,
  ImprovementMetricObservationV1,
  ImprovementObservationAdapterDescriptorV1,
  ImprovementObservationWindowV1,
  ImprovementProtocolSourceObservationV1,
} from "@lervo/application-contract";

const HASH = /^sha256:[a-f0-9]{64}$/u;
const PATTERN_ID = /^pattern_[a-f0-9]{24}$/u;
const PROJECT_ID = /^prj_[a-f0-9]{16}$/u;
const VERSION = /^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/u;
const METRICS = new Set<ImprovementMetricIdV1>([
  "source_recall",
  "unnecessary_context",
  "verification_success",
  "repeated_failure",
  "rework",
  "user_correction",
]);

function bounded(value: unknown, prefix: string): value is string {
  return typeof value === "string" && value.length <= 128 && value.startsWith(`${prefix}_`);
}

export function stableImprovementEffectJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableImprovementEffectJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableImprovementEffectJson(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

export function improvementEffectDigest(value: unknown): string {
  return `sha256:${createHash("sha256").update(stableImprovementEffectJson(value)).digest("hex")}`;
}

export function improvementEffectId(
  prefix: "ieplan" | "ieprotocol" | "iecomparison",
  value: unknown,
): string {
  const digest = improvementEffectDigest(value);
  return `${prefix}_${digest.slice("sha256:".length, "sha256:".length + 24)}`;
}

function validateDescriptor(descriptor: ImprovementObservationAdapterDescriptorV1): void {
  if (
    descriptor.schemaVersion !== 1 ||
    !bounded(descriptor.adapterId, "iobs") ||
    !VERSION.test(descriptor.adapterVersion) ||
    !HASH.test(descriptor.descriptorHash) ||
    !["available", "unavailable"].includes(descriptor.availability) ||
    descriptor.authentication !== "adapter_verified" ||
    descriptor.rawEvidence !== "adapter_private" ||
    descriptor.capabilities.length !== 1 ||
    descriptor.capabilities[0] !== "rate_observation.verify"
  )
    throw new TypeError("The improvement observation adapter descriptor is invalid.");
}

function validateWindow(window: ImprovementObservationWindowV1): void {
  const startedAt = Date.parse(window.startedAt);
  const endedAt = Date.parse(window.endedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt > endedAt)
    throw new TypeError("The improvement observation window is invalid.");
}

function validateObservations(observations: ImprovementMetricObservationV1[]): void {
  if (
    !Array.isArray(observations) ||
    observations.length === 0 ||
    observations.length > METRICS.size ||
    new Set(observations.map((item) => item.metricId)).size !== observations.length ||
    observations.some(
      (item) =>
        !METRICS.has(item.metricId) ||
        !Number.isSafeInteger(item.numerator) ||
        !Number.isSafeInteger(item.denominator) ||
        item.numerator < 0 ||
        item.denominator < 1 ||
        item.denominator > 1_000_000 ||
        item.numerator > item.denominator ||
        !HASH.test(item.evidenceSetHash) ||
        !HASH.test(item.observationReceiptHash),
    )
  )
    throw new TypeError("The improvement metric observations are invalid.");
}

export function orderedImprovementObservations(
  observations: ImprovementMetricObservationV1[],
): ImprovementMetricObservationV1[] {
  validateObservations(observations);
  return [...observations].sort((left, right) => left.metricId.localeCompare(right.metricId));
}

export function validateImprovementProtocolRequest(
  request: ImprovementEvaluationProtocolRequestV1,
): void {
  if (
    request.schemaVersion !== 1 ||
    !PATTERN_ID.test(request.patternId) ||
    !HASH.test(request.candidateContentHash) ||
    !HASH.test(request.reviewContentHash) ||
    !HASH.test(request.targetContentHash) ||
    !HASH.test(request.requestDigest) ||
    !Number.isFinite(Date.parse(request.registeredAt))
  )
    throw new TypeError("The improvement evaluation protocol request is invalid.");
  validateDescriptor(request.adapter);
  validateWindow(request.baselineWindow);
  validateObservations(request.baseline);
}

export function validateImprovementProtocolSource(
  source: ImprovementProtocolSourceObservationV1,
): void {
  if (
    !PROJECT_ID.test(source.projectId) ||
    !PATTERN_ID.test(source.patternId) ||
    (source.candidateContentHash !== null && !HASH.test(source.candidateContentHash)) ||
    (source.reviewContentHash !== null && !HASH.test(source.reviewContentHash)) ||
    !HASH.test(source.targetContentHash) ||
    !Number.isFinite(Date.parse(source.observedAt))
  )
    throw new TypeError("The improvement protocol source observation is invalid.");
}

export function validateImprovementEffectRequest(
  request: ImprovementEffectObservationRequestV1,
): void {
  if (
    request.schemaVersion !== 1 ||
    !bounded(request.protocolId, "ieprotocol") ||
    !PATTERN_ID.test(request.patternId) ||
    !HASH.test(request.requestDigest) ||
    !Number.isFinite(Date.parse(request.observedAt))
  )
    throw new TypeError("The improvement effect observation request is invalid.");
  validateDescriptor(request.adapter);
  validateWindow(request.treatmentWindow);
  validateObservations(request.treatment);
}

export function validateImprovementEffectSource(
  source: ImprovementEffectSourceObservationV1,
): void {
  if (
    !PROJECT_ID.test(source.projectId) ||
    !bounded(source.protocolPlanId, "ieplan") ||
    !bounded(source.registrationEventId, "evt") ||
    !Number.isFinite(Date.parse(source.registeredAt)) ||
    !bounded(source.promotionEventId, "evt") ||
    !Number.isFinite(Date.parse(source.promotedAt)) ||
    !HASH.test(source.currentTargetContentHash)
  )
    throw new TypeError("The improvement effect source observation is invalid.");
  validateImprovementProtocolRequest(source.protocol);
}
