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
      "Verified 지식 CAS 원본을 읽지 못했습니다.",
      { cause: error },
    );
  }
  if (
    !validateSchema("verifiedKnowledge", input.knowledge).valid ||
    calculateVerifiedKnowledgeId(input.knowledge) !== input.knowledge.knowledgeId ||
    input.knowledgeArtifact.artifactId !== `art_${input.knowledgeArtifact.contentHash.slice(7)}` ||
    input.knowledgeArtifact.uri !== `lervo-cas://sha256/${input.knowledgeArtifact.contentHash.slice(7)}` ||
    input.knowledgeArtifact.contentHash !== knowledgeSha256(knowledgeBytes) ||
    input.knowledgeArtifact.byteCount !== knowledgeBytes.byteLength ||
    !Buffer.from(verifiedKnowledgeBytes(input.knowledge)).equals(Buffer.from(knowledgeBytes))
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "knowledge_artifact_mismatch",
      "Verified 지식 원본의 schema, hash 또는 ID가 다릅니다.",
    );
  }
  if (
    !input.events.list().some((event) =>
      event.type === "knowledge.verified" &&
      event.payload.knowledgeId === input.knowledge.knowledgeId &&
      event.payload.knowledgeContentHash === input.knowledgeArtifact.contentHash) ||
    input.result.knowledgeId !== input.knowledge.knowledgeId ||
    input.result.projectId !== input.knowledge.projectId ||
    input.result.verifiedRevision !== input.knowledge.verifiedRevision
  ) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "Stale 결과가 verified 지식 원본과 결속되지 않았습니다.",
    );
  }
  validateKnowledgeStalenessResult(input.result);
  if (input.result.status !== "stale" || input.result.reasons.length === 0) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_not_stale",
      "Current 판정은 stale 감지 event로 기록하지 않습니다.",
    );
  }
  if (input.events.list().some((event) =>
    event.type === "knowledge.stale.detected" && event.payload.resultId === input.result.resultId)) {
    throw new KnowledgeError(
      "staleness_contract_invalid",
      "staleness_schema_invalid",
      "같은 stale 판정이 이미 event에 기록되어 있습니다.",
    );
  }
  const resultArtifact = await storeKnowledgeArtifact({
    artifactStore: input.artifactStore,
    bytes: knowledgeStalenessResultBytes(input.result),
    mismatchReason: "staleness_artifact_mismatch",
    label: "지식 stale 판정",
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
      "지식 stale 감지 event를 기록하지 못했습니다.",
      { cause: error },
    );
  }
}
