import type { ProjectStorage } from "@lervo/project-storage";
import { validateSchema } from "@lervo/schemas";
import { canonicalHash } from "@lervo/search";

export interface QualityRecordInput {
  repositoryRoot: string;
  requestId: string;
  coordinates?: { runId: string; sessionId: string };
  projectId?: string;
  identity: string;
  type: "context.quality.prepared" | "context.quality.verified";
  policyVersion: string;
  report: unknown;
  payload: Record<string, unknown>;
}
type EventDraft = Parameters<ProjectStorage["events"]["append"]>[0];
export type QualityEventDraft = Omit<Extract<EventDraft, { schemaVersion: 6 }>, "projectId">;

/** Build and validate immutable report metadata before its storage authority observation. */
export function prepareQualityEvent(
  input: QualityRecordInput,
  artifactHash: string,
): QualityEventDraft {
  const payload = {
    ...input.payload,
    [input.type === "context.quality.prepared" ? "reportArtifactHash" : "verificationArtifactHash"]:
      artifactHash,
  };
  if (
    !validateSchema(
      input.type === "context.quality.prepared"
        ? "contextQualityPreparedEventPayload"
        : "contextQualityVerifiedEventPayload",
      payload,
    ).valid
  )
    throw new TypeError("Invalid quality event.");
  return {
    eventId: `evt_${canonicalHash({ type: input.type, identity: input.identity }).slice(7, 39)}`,
    runId: input.coordinates?.runId ?? `run_${canonicalHash(input.requestId).slice(7, 39)}`,
    sessionId: input.coordinates?.sessionId ?? `ses_${canonicalHash(input.requestId).slice(7, 39)}`,
    type: input.type,
    schemaVersion: 6,
    actor: { kind: "system" },
    occurredAt: new Date().toISOString(),
    policyVersion: input.policyVersion,
    payload,
  };
}
