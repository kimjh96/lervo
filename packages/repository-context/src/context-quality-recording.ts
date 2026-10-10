import { createContextQualityCommitQueue } from "./context-quality-commit.js";
import { validContextOutcomeObservation } from "./context-outcome-observation.js";
import { createProjectStoragePool, ProjectStorageError } from "@lervo/project-storage";
import { canonicalHash } from "@lervo/search";
import { storeVerificationBytes } from "@lervo/verification";
import {
  validateSchema,
  type ContextQualityPreparedEventPayload,
  type ContextQualityRequest,
  type ContextQualityVerification,
} from "@lervo/schemas";
import type { ContextQualityPreparationResult } from "./context-quality-preparation.js";

const recordingStorage = createProjectStoragePool(undefined, { requiredEventSchemaVersion: 6 });
const commitQualityEvent = createContextQualityCommitQueue();

type Bindings = Pick<
  ContextQualityRequest,
  | "projectId"
  | "taskRevision"
  | "sourceSnapshotId"
  | "scopeDigest"
  | "policySetDigest"
  | "profileId"
>;
export type ContextQualityRecording =
  | { status: "recorded"; eventId: string; artifactHash: string }
  | { status: "writer_not_active" | "unavailable" };

/** Existing CAS and append-only stores own retention. Failure never becomes a durable success receipt. */
async function record(input: {
  repositoryRoot: string;
  requestId: string;
  coordinates?: { runId: string; sessionId: string };
  projectId?: string;
  identity: string;
  type: "context.quality.prepared" | "context.quality.verified";
  policyVersion: string;
  report: unknown;
  payload: Record<string, unknown>;
}): Promise<ContextQualityRecording> {
  const snapshot = structuredClone(input);
  input = snapshot;
  try {
    const bytes = Buffer.from(JSON.stringify(input.report));
    if (bytes.byteLength > 1048576) throw new TypeError("Quality report exceeds storage bound.");
    input.report = undefined;
    return await recordingStorage.run(
      input.repositoryRoot,
      async (storage, assertCurrent): Promise<ContextQualityRecording> => {
        if (input.projectId !== undefined && input.projectId !== storage.manifest.projectId)
          return { status: "unavailable" };
        if (storage.writableEventSchemaVersion !== 6) return { status: "writer_not_active" };
        const eventId = `evt_${canonicalHash({ type: input.type, identity: input.identity }).slice(7, 39)}`;
        let artifactHash!: string;
        await commitQualityEvent(storage, assertCurrent, async () => {
          const artifact = await storeVerificationBytes(storage.artifacts, bytes);
          artifactHash = artifact.contentHash;
          const payload = {
            ...input.payload,
            [input.type === "context.quality.prepared"
              ? "reportArtifactHash"
              : "verificationArtifactHash"]: artifact.contentHash,
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
            eventId,
            projectId: storage.manifest.projectId,
            runId: input.coordinates?.runId ?? `run_${canonicalHash(input.requestId).slice(7, 39)}`,
            sessionId:
              input.coordinates?.sessionId ?? `ses_${canonicalHash(input.requestId).slice(7, 39)}`,
            type: input.type,
            schemaVersion: 6,
            actor: { kind: "system" },
            occurredAt: new Date().toISOString(),
            policyVersion: input.policyVersion,
            payload,
          };
        });
        return { status: "recorded", eventId, artifactHash };
      },
    );
  } catch (error) {
    if (error instanceof ProjectStorageError && error.code === "storage_writer_not_active")
      return { status: "writer_not_active" };
    return { status: "unavailable" };
  }
}
export function recordContextQualityPreparation(input: {
  repositoryRoot: string;
  result: ContextQualityPreparationResult;
  bindings: Bindings | null;
  originKind: ContextQualityPreparedEventPayload["originKind"];
  adapterBuildId: string;
  coordinates?: { runId: string; sessionId: string };
}): Promise<ContextQualityRecording> {
  const { result, bindings } = input;
  const plan = result.plan;
  return record({
    repositoryRoot: input.repositoryRoot,
    ...(input.coordinates ? { coordinates: input.coordinates } : {}),
    ...(bindings ? { projectId: bindings.projectId } : {}),
    requestId: result.requestId,
    identity: result.requestId,
    type: "context.quality.prepared",
    policyVersion: bindings?.policySetDigest ?? canonicalHash("context_unbound_v1"),
    report: { result, bindings },
    payload: {
      schemaVersion: 1,
      requestId: result.requestId,
      taskRevision: bindings?.taskRevision ?? null,
      semanticInputDigest: plan?.semanticInputDigest ?? null,
      planDigest: plan?.planDigest ?? null,
      sourceSnapshotId: bindings?.sourceSnapshotId ?? null,
      scopeDigest: bindings?.scopeDigest ?? null,
      policySetDigest: bindings?.policySetDigest ?? null,
      profileId: bindings?.profileId ?? null,
      executionMode: "unmanaged",
      originKind: input.originKind,
      adapterBuildId: input.adapterBuildId,
      status: result.status,
      reasonCodes: result.reasonCodes,
      requiredCount: plan?.coverage.required ?? null,
      resolvedCount: plan?.coverage.resolved ?? null,
      loadedCount: plan?.coverage.loaded ?? null,
      evidenceCount: plan?.coverage.packedEvidenceCount ?? null,
      sectionCount: plan?.sections.length ?? null,
      coverageDisposition: plan?.corpusCoverage.disposition ?? "unavailable",
      stageObservationHashes: [],
    } satisfies Omit<ContextQualityPreparedEventPayload, "reportArtifactHash">,
  });
}
export function recordContextQualityVerification(input: {
  repositoryRoot: string;
  requestId: string;
  coordinates?: { runId: string; sessionId: string };
  policySetDigest: string;
  projectId: string;
  observation: ContextQualityVerification;
}): Promise<ContextQualityRecording> {
  const observation = structuredClone(input.observation);
  if (!validContextOutcomeObservation(observation))
    return Promise.resolve({ status: "unavailable" });
  const { observationDigest } = observation;
  return record({
    repositoryRoot: input.repositoryRoot,
    ...(input.coordinates ? { coordinates: input.coordinates } : {}),
    requestId: input.requestId,
    projectId: input.projectId,
    identity: canonicalHash({ requestId: input.requestId, observationDigest }),
    type: "context.quality.verified",
    policyVersion: input.policySetDigest,
    report: observation,
    payload: {
      schemaVersion: 1,
      requestId: input.requestId,
      planDigest: observation.planDigest,
      artifactDigest: observation.artifactDigest,
      verificationDefinitionId: observation.verificationDefinitionId,
      verificationDefinitionHash: observation.verificationDefinitionHash,
      evaluatorBuildId: observation.evaluatorBuildId,
      disposition: observation.disposition,
      reasonCodes: observation.reasonCodes,
    },
  });
}
