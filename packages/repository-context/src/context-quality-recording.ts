import { prepareQualityEvent, type QualityRecordInput } from "./context-quality-event.js";
import { createQualityRecordingAdmission } from "./context-quality-admission.js";
import { createQualityRecordingScopes } from "./context-quality-scope.js";
import { createHash } from "node:crypto";
import { createContextQualityCommitQueue } from "./context-quality-commit.js";
import { validContextOutcomeObservation } from "./context-outcome-observation.js";
import { createProjectStoragePool, ProjectStorageError } from "@lervo/project-storage";
import { canonicalHash } from "@lervo/search";
import { storeVerificationBytes } from "@lervo/verification";
import {
  type ContextQualityPreparedEventPayload,
  type ContextQualityRequest,
  type ContextQualityVerification,
} from "@lervo/schemas";
import type { ContextQualityPreparationResult } from "./context-quality-preparation.js";

const recordingStorage = createProjectStoragePool(undefined, { minimumEventSchemaVersion: 6 });
const commitQualityEvent = createContextQualityCommitQueue();
const recordingScopes = createQualityRecordingScopes();
const recordingAdmission = createQualityRecordingAdmission((root, work) =>
  recordingStorage.run(root, work),
);

export function beginContextQualityObservationScope(
  repositoryRoot: string,
  requestId: string,
  beforeStorage = false,
) {
  return recordingScopes.begin(repositoryRoot, requestId, beforeStorage);
}

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

type RecordingFailure = Exclude<ContextQualityRecording, { status: "recorded" }>;
function recordingFailure(error: unknown): RecordingFailure {
  return {
    status:
      error instanceof ProjectStorageError && error.code === "storage_writer_not_active"
        ? "writer_not_active"
        : "unavailable",
  };
}

/** Opening is drained by the observation owner and never grants a recording receipt. */
export async function beginContextQualityStorageOpening(
  repositoryRoot: string,
): Promise<RecordingFailure | { status: "available"; reportWriting: boolean }> {
  try {
    return { status: "available", ...(await recordingStorage.startOpening(repositoryRoot)) };
  } catch (error) {
    return recordingFailure(error);
  }
}

/** Storage adapters own retention. Failure never becomes a durable success receipt. */
async function record(input: QualityRecordInput): Promise<ContextQualityRecording> {
  const snapshot = structuredClone(input);
  input = snapshot;
  try {
    const bytes = Buffer.from(JSON.stringify(input.report));
    if (bytes.byteLength > 1048576) throw new TypeError("Quality report exceeds storage bound.");
    input.report = undefined;
    const scope = recordingScopes.admission(
      input.repositoryRoot,
      input.requestId,
      input.type === "context.quality.prepared" ? "prepared" : "verified",
    );
    if (scope?.beforeStorage) {
      const contentHash = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
      const receipt = await recordingAdmission.admit(
        input.repositoryRoot,
        {
          bytes,
          contentHash,
          draft: prepareQualityEvent(input, contentHash),
          ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
        },
        scope,
      );
      return receipt ? { status: "recorded", ...receipt } : { status: "unavailable" };
    }
    return await recordingAdmission.runLegacy(
      input.repositoryRoot,
      async (storage, assertCurrent): Promise<ContextQualityRecording> => {
        if (input.projectId !== undefined && input.projectId !== storage.manifest.projectId)
          return { status: "unavailable" };
        if ((storage.writableEventSchemaVersion ?? 0) < 6) return { status: "writer_not_active" };
        let eventId!: string;
        const report = storage.events.reportWriter
          ? {
              bytes,
              contentHash: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
            }
          : undefined;
        let artifactHash!: string;
        await commitQualityEvent(
          storage,
          assertCurrent,
          async () => {
            const artifact = report ?? (await storeVerificationBytes(storage.artifacts, bytes));
            artifactHash = artifact.contentHash;
            const draft = prepareQualityEvent(input, artifactHash);
            eventId = draft.eventId;
            return { ...draft, projectId: storage.manifest.projectId };
          },
          report,
          report
            ? recordingScopes.admission(
                input.repositoryRoot,
                input.requestId,
                input.type === "context.quality.prepared" ? "prepared" : "verified",
              )
            : undefined,
        );
        return { status: "recorded", eventId, artifactHash };
      },
    );
  } catch (error) {
    return recordingFailure(error);
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
