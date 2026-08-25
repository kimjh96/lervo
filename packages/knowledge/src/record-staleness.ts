import { validateSchema } from "@lervo/schemas";

import { storeKnowledgeArtifact } from "./artifact-storage.js";
import {
  calculateVerifiedKnowledgeId,
  knowledgeSha256,
  knowledgeStalenessResultBytes,
  verifiedKnowledgeBytes,
} from "./integrity.js";
import { validateKnowledgeStalenessResult } from "./knowledge-staleness.js";
import {
  KnowledgeError,
  type RecordedKnowledgeStaleness,
  type RecordKnowledgeStalenessInput,
} from "./types.js";

export async function recordKnowledgeStaleness(
  input: RecordKnowledgeStalenessInput,
): Promise<RecordedKnowledgeStaleness> {
  let knowledgeBytes: Uint8Array;
  try {
    knowledgeBytes = await input.artifactStore.get(input.knowledgeArtifact.uri);
  } catch (error) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "knowledge_artifact_mismatch",
      "Could not read the verified knowledge CAS source.",
      { cause: error },
    );
  }
  if (
    !validateSchema("verifiedKnowledge", input.knowledge).valid ||
    calculateVerifiedKnowledgeId(input.knowledge) !== input.knowledge.knowledgeId ||
    input.knowledgeArtifact.artifactId !== `art_${input.knowledgeArtifact.contentHash.slice(7)}` ||
    input.knowledgeArtifact.uri !==
      `lervo-cas://sha256/${input.knowledgeArtifact.contentHash.slice(7)}` ||
    input.knowledgeArtifact.contentHash !== knowledgeSha256(knowledgeBytes) ||
    input.knowledgeArtifact.byteCount !== knowledgeBytes.byteLength ||
    !Buffer.from(verifiedKnowledgeBytes(input.knowledge)).equals(Buffer.from(knowledgeBytes))
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "knowledge_artifact_mismatch",
      "The verified knowledge source schema, hash, or ID differs.",
    );
  }
  if (
    !input.events
      .list()
      .some(
        (event) =>
          event.type === "knowledge.verified" &&
          event.payload.knowledgeId === input.knowledge.knowledgeId &&
          event.payload.knowledgeContentHash === input.knowledgeArtifact.contentHash,
      ) ||
    input.result.knowledgeId !== input.knowledge.knowledgeId ||
    input.result.projectId !== input.knowledge.projectId ||
    input.result.verifiedRevision !== input.knowledge.verifiedRevision
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The staleness result is not bound to the verified knowledge source.",
    );
  }
  validateKnowledgeStalenessResult(input.result);
  if (input.result.status !== "stale" || input.result.reasons.length === 0) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_not_stale",
      "A current decision is not recorded as a staleness-detected event.",
    );
  }
  if (
    input.events
      .list()
      .some(
        (event) =>
          event.type === "knowledge.stale.detected" &&
          event.payload.resultId === input.result.resultId,
      )
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "The same staleness decision is already recorded in an event.",
    );
  }
  const resultArtifact = await storeKnowledgeArtifact({
    artifactStore: input.artifactStore,
    bytes: knowledgeStalenessResultBytes(input.result),
    mismatchReason: "staleness_artifact_mismatch",
    label: "knowledge staleness decision",
  });
  try {
    const recordedEvent = input.events.append({
      eventId: input.createEventId(),
      projectId: input.result.projectId,
      runId: input.runId,
      sessionId: input.sessionId,
      type: "knowledge.stale.detected",
      occurredAt: input.result.evaluatedAt,
      actor: { kind: "system" },
      schemaVersion: 1,
      policyVersion: input.policyVersion,
      payload: {
        knowledgeId: input.result.knowledgeId,
        resultId: input.result.resultId,
        verifiedRevision: input.result.verifiedRevision,
        currentRevision: input.result.currentRevision,
        reasons: input.result.reasons,
        changedPaths: input.result.signals.paths.changedPaths,
        missingPaths: input.result.signals.paths.missingPaths,
        resultArtifactId: resultArtifact.artifactId,
        resultContentHash: resultArtifact.contentHash,
      },
    }).event;
    return { result: input.result, resultArtifact, recordedEvent };
  } catch (error) {
    throw new KnowledgeError(
      "event_recording_failed",
      "event_store_failed",
      "Could not record the knowledge staleness-detected event.",
      { cause: error },
    );
  }
}
