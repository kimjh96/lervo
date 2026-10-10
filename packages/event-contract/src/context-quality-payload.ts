import {
  contextQualityPreparedEventPayloadSchema,
  contextQualityVerifiedEventPayloadSchema,
} from "@lervo/schemas";
export const contextQualityPayloadAllowlists = {
  "context.quality.prepared": Object.keys(contextQualityPreparedEventPayloadSchema.properties),
  "context.quality.verified": Object.keys(contextQualityVerifiedEventPayloadSchema.properties),
} as const;
export const contextQualityPayloadSchemas = {
  "context.quality.prepared": "contextQualityPreparedEventPayload",
  "context.quality.verified": "contextQualityVerifiedEventPayload",
} as const;
/** Nullable coordinates represent failure before binding, never successful preparation. */
export function validateContextQualityPayload(type: string, payload: Record<string, unknown>) {
  if (type === "context.quality.verified") {
    if (
      payload.disposition === "passed" &&
      (!Array.isArray(payload.reasonCodes) ||
        payload.reasonCodes.some((reason) => reason !== "context_language_exception"))
    )
      throw new TypeError("Passed verification cannot contain failure reasons.");
    return;
  }
  if (type !== "context.quality.prepared") return;
  const bound = [
    "taskRevision",
    "semanticInputDigest",
    "planDigest",
    "sourceSnapshotId",
    "scopeDigest",
    "policySetDigest",
    "profileId",
    "requiredCount",
    "resolvedCount",
    "loadedCount",
    "evidenceCount",
    "sectionCount",
  ];
  if (
    ["ready", "no_evidence", "incomplete"].includes(String(payload.status)) &&
    bound.some((key) => payload[key] === null)
  )
    throw new TypeError("Prepared plan coordinates are missing.");
  const { requiredCount, resolvedCount, loadedCount, status, coverageDisposition } = payload;
  if (
    typeof requiredCount === "number" &&
    typeof resolvedCount === "number" &&
    typeof loadedCount === "number"
  ) {
    if (loadedCount > resolvedCount || resolvedCount > requiredCount)
      throw new TypeError("Invalid clause counts.");
    if (
      (status === "ready" || status === "no_evidence") &&
      (loadedCount !== requiredCount || coverageDisposition !== "complete")
    )
      throw new TypeError("Successful preparation requires complete coverage.");
  }
}
