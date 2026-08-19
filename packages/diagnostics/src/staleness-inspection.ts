import {
  calculateKnowledgeStalenessResultId,
  knowledgeSha256,
  knowledgeStalenessResultBytes,
} from "@lervo/knowledge";
import {
  validateSchema,
  type EventEnvelope,
  type KnowledgeStaleDetectedEventPayload,
  type KnowledgeStalenessResult,
} from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import type { DoctorIssue } from "./types.js";

export async function inspectKnowledgeStaleness(input: {
  event: EventEnvelope;
  events: readonly EventEnvelope[];
  artifacts: ArtifactStore;
}): Promise<DoctorIssue[]> {
  const issues: DoctorIssue[] = [];
  const add = (code: DoctorIssue["code"], message: string) =>
    issues.push({ code, eventId: input.event.eventId, message });
  if (!validateSchema("knowledgeStaleDetectedEventPayload", input.event.payload).valid) {
    add("staleness_event_mismatch", "지식 stale event가 현재 payload 계약과 다릅니다.");
    return issues;
  }
  const payload = input.event.payload as unknown as KnowledgeStaleDetectedEventPayload;
  let result: KnowledgeStalenessResult;
  try {
    const uri = `lervo-cas://sha256/${payload.resultContentHash.slice(7)}`;
    const bytes = await input.artifacts.get(uri);
    const parsed = JSON.parse(Buffer.from(bytes).toString("utf8")) as unknown;
    if (!validateSchema("knowledgeStalenessResult", parsed).valid) throw new Error("schema");
    result = parsed as KnowledgeStalenessResult;
    if (
      result.status !== "stale" || result.reasons.length === 0 ||
      knowledgeSha256(bytes) !== payload.resultContentHash ||
      payload.resultArtifactId !== `art_${payload.resultContentHash.slice(7)}` ||
      calculateKnowledgeStalenessResultId(result) !== result.resultId ||
      !Buffer.from(knowledgeStalenessResultBytes(result)).equals(Buffer.from(bytes))
    ) throw new Error("coordinate");
  } catch {
    add("staleness_artifact_invalid", "지식 stale 결과 CAS 원본을 확인할 수 없습니다.");
    return issues;
  }
  if (
    result.resultId !== payload.resultId || result.knowledgeId !== payload.knowledgeId ||
    result.verifiedRevision !== payload.verifiedRevision ||
    result.currentRevision !== payload.currentRevision ||
    JSON.stringify(result.reasons) !== JSON.stringify(payload.reasons) ||
    JSON.stringify(result.signals.paths.changedPaths) !== JSON.stringify(payload.changedPaths) ||
    JSON.stringify(result.signals.paths.missingPaths) !== JSON.stringify(payload.missingPaths)
  ) {
    add("staleness_event_mismatch", "지식 stale 결과와 event 좌표가 다릅니다.");
  }
  if (!input.events.some((event) =>
    event.type === "knowledge.verified" && event.payload.knowledgeId === result.knowledgeId)) {
    add("staleness_verified_missing", "지식 stale 결과의 verified 원본 event가 없습니다.");
  }
  return issues;
}
