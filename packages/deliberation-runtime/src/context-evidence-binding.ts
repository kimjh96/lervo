import type { ManagedProviderRunResult } from "@lervo/orchestrator";
import {
  validateSchema,
  type DeliberationArtifact,
  type EventEnvelope,
  type SharedContextPublication,
} from "@lervo/schemas";

import { DeliberationRuntimeError } from "./types.js";

export interface DeliberationContextEvidenceBinding {
  contextGeneration: number;
  loadedReceiptIds: string[];
  injectedReceiptIds: string[];
  sharedContextIds: string[];
  evidenceEventIds: string[];
}

function fail(
  reason:
    | "managed_run_coordinate_mismatch"
    | "managed_run_event_missing"
    | "previous_artifact_not_loaded"
    | "receipt_event_mismatch"
    | "shared_context_invalid",
  message: string,
): never {
  throw new DeliberationRuntimeError("context_evidence_invalid", reason, message);
}

function sameStringArray(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

export function validateManagedRunContextEvidence(input: {
  run: ManagedProviderRunResult;
  events: readonly EventEnvelope[];
  previousArtifacts: readonly DeliberationArtifact[];
  sharedContextPublications: readonly SharedContextPublication[];
}): DeliberationContextEvidenceBinding {
  const { run } = input;
  const loaded = run.contextEvidence.filter((evidence) => evidence.state === "loaded");
  const injected = run.contextEvidence.filter((evidence) => evidence.state === "injected");
  if (loaded.length === 0 || injected.length === 0) {
    fail("receipt_event_mismatch", "Managed run에 E2 또는 E3 context evidence가 없습니다.");
  }
  if (run.session.providerSessionId !== run.turn.providerSessionId) {
    fail("managed_run_coordinate_mismatch", "Managed run의 session과 turn 좌표가 다릅니다.");
  }
  for (const evidence of [...loaded, ...injected]) {
    if (
      evidence.projectId !== run.session.projectId || evidence.runId !== run.session.runId ||
      evidence.sessionId !== run.session.sessionId
    ) {
      fail("managed_run_coordinate_mismatch", "Context evidence가 managed run 좌표와 다릅니다.");
    }
  }

  const eventIds: string[] = [];
  for (const evidence of loaded) {
    const event = input.events.find((candidate) =>
      candidate.type === "document.loaded" &&
      candidate.payload.evidenceReceiptId === evidence.receiptId,
    );
    if (
      event === undefined || event.projectId !== evidence.projectId ||
      event.runId !== evidence.runId || event.sessionId !== evidence.sessionId ||
      event.payload.documentId !== evidence.documentId ||
      event.payload.contentHash !== evidence.contentHash ||
      event.payload.byteCount !== evidence.byteCount ||
      event.payload.sourceRevision !== evidence.sourceRevision
    ) {
      fail("receipt_event_mismatch", "E2 context receipt와 document.loaded event가 다릅니다.");
    }
    eventIds.push(event.eventId);
  }

  const injectedByEvent = new Map<EventEnvelope, typeof injected>();
  for (const evidence of injected) {
    const event = input.events.find((candidate) =>
      candidate.type === "context.injected" &&
      Array.isArray(candidate.payload.evidenceReceiptIds) &&
      candidate.payload.evidenceReceiptIds.includes(evidence.receiptId),
    );
    if (
      event === undefined || event.projectId !== evidence.projectId ||
      event.runId !== evidence.runId || event.sessionId !== evidence.sessionId ||
      event.actor.provider !== evidence.provider ||
      event.payload.receiptId !== evidence.adapterReceiptId ||
      event.payload.envelopeId !== evidence.envelopeId ||
      event.payload.targetTurnId !== evidence.targetTurnId ||
      event.payload.contextGeneration !== evidence.contextGeneration ||
      !Array.isArray(event.payload.documentIds) ||
      !event.payload.documentIds.includes(evidence.documentId)
    ) {
      fail("receipt_event_mismatch", "E3 context receipt와 context.injected event가 다릅니다.");
    }
    const group = injectedByEvent.get(event) ?? [];
    group.push(evidence);
    injectedByEvent.set(event, group);
  }
  for (const [event, evidence] of injectedByEvent) {
    if (!sameStringArray(
      event.payload.evidenceReceiptIds,
      evidence.map((item) => item.receiptId),
    )) {
      fail("receipt_event_mismatch", "context.injected event의 E3 receipt 목록이 실제 목록과 다릅니다.");
    }
    eventIds.push(event.eventId);
  }

  const completed = input.events.filter((event) => event.type === "run.completed");
  if (
    completed.length !== 1 ||
    completed[0]!.payload.resultDigest !== run.resultArtifact.contentHash ||
    !sameStringArray(completed[0]!.payload.artifactIds, [run.resultArtifact.artifactId])
  ) {
    fail("managed_run_event_missing", "Managed run 완료 event가 result artifact와 다릅니다.");
  }
  eventIds.push(completed[0]!.eventId);

  const generations = new Set(injected.map((evidence) => evidence.contextGeneration));
  if (generations.size !== 1 || !generations.has(run.contextGeneration)) {
    fail("receipt_event_mismatch", "Provider 결과가 생성된 뒤 context generation이 무효화되었습니다.");
  }

  for (const publication of input.sharedContextPublications) {
    if (!validateSchema("sharedContext", publication).valid) {
      fail("shared_context_invalid", "Shared context publication이 schema를 통과하지 못했습니다.");
    }
    const loadedEvidence = loaded.find((evidence) =>
      evidence.documentId === publication.documentId &&
      evidence.contentHash === publication.contentHash,
    );
    const injectedEvidence = injected.find((evidence) =>
      evidence.documentId === publication.documentId &&
      evidence.contentHash === publication.contentHash,
    );
    if (loadedEvidence === undefined || injectedEvidence === undefined) {
      fail("shared_context_invalid", "Shared context 원문이 현재 역할의 E2/E3에 없습니다.");
    }
  }
  for (const previous of input.previousArtifacts) {
    const publication = input.sharedContextPublications.find((candidate) =>
      candidate.projectId === previous.projectId &&
      candidate.contentHash === previous.content.contentHash &&
      candidate.producer.kind === "agent" &&
      candidate.producer.roleId === previous.producer.roleId &&
      candidate.producer.runId === previous.producer.runId &&
      candidate.producer.sessionId === previous.producer.sessionId,
    );
    if (publication === undefined) {
      fail("previous_artifact_not_loaded", "이전 숙의 artifact가 shared context로 다시 적재되지 않았습니다.");
    }
  }

  return {
    contextGeneration: run.contextGeneration,
    loadedReceiptIds: loaded.map((evidence) => evidence.receiptId),
    injectedReceiptIds: injected.map((evidence) => evidence.receiptId),
    sharedContextIds: input.sharedContextPublications.map((item) => item.sharedContextId),
    evidenceEventIds: input.events
      .filter((event) => eventIds.includes(event.eventId))
      .sort((left, right) => left.seq - right.seq)
      .map((event) => event.eventId),
  };
}
