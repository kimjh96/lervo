import {
  validateSchema,
  type EventEnvelope,
  type SharedContextPublication,
} from "@lervo/schemas";

import {
  ManagedProviderRunError,
  type ManagedProviderRunResult,
} from "./provider-run-types.js";

export interface ManagedProviderRunEvidenceBinding {
  contextGeneration: number;
  loadedReceiptIds: string[];
  injectedReceiptIds: string[];
  sharedContextIds: string[];
  evidenceEventIds: string[];
}

function fail(message: string): never {
  throw new ManagedProviderRunError("contract_validation_failed", message);
}

function sameStringArray(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

/**
 * Revalidates the durable E2/E3 receipts and completion event for one managed
 * provider run. Callers may add domain-specific lineage checks afterwards.
 */
export function validateManagedProviderRunEvidence(input: {
  run: ManagedProviderRunResult;
  events: readonly EventEnvelope[];
  sharedContextPublications: readonly SharedContextPublication[];
}): ManagedProviderRunEvidenceBinding {
  const { run } = input;
  const loaded = run.contextEvidence.filter((evidence) => evidence.state === "loaded");
  const injected = run.contextEvidence.filter((evidence) => evidence.state === "injected");
  if (loaded.length === 0 || injected.length === 0) {
    fail("Managed run에 E2 또는 E3 context evidence가 없습니다.");
  }
  if (run.session.providerSessionId !== run.turn.providerSessionId) {
    fail("Managed run의 session과 turn 좌표가 다릅니다.");
  }
  for (const evidence of [...loaded, ...injected]) {
    if (
      evidence.projectId !== run.session.projectId || evidence.runId !== run.session.runId ||
      evidence.sessionId !== run.session.sessionId
    ) fail("Context evidence가 managed run 좌표와 다릅니다.");
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
    ) fail("E2 context receipt와 document.loaded event가 다릅니다.");
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
    ) fail("E3 context receipt와 context.injected event가 다릅니다.");
    const group = injectedByEvent.get(event) ?? [];
    group.push(evidence);
    injectedByEvent.set(event, group);
  }
  for (const [event, evidence] of injectedByEvent) {
    if (!sameStringArray(
      event.payload.evidenceReceiptIds,
      evidence.map((item) => item.receiptId),
    )) fail("context.injected event의 E3 receipt 목록이 실제 목록과 다릅니다.");
    eventIds.push(event.eventId);
  }

  const completed = input.events.filter((event) => event.type === "run.completed");
  const expectedArtifactIds = [...new Set([
    run.resultArtifact.artifactId,
    ...run.verifications.map((item) => item.resultArtifact.artifactId),
  ])];
  if (
    completed.length !== 1 ||
    completed[0]!.payload.resultDigest !== run.resultArtifact.contentHash ||
    completed[0]!.payload.verificationStatus !== run.verificationStatus ||
    !sameStringArray(completed[0]!.payload.artifactIds, expectedArtifactIds)
  ) fail("Managed run 완료 event가 result artifact와 다릅니다.");
  eventIds.push(completed[0]!.eventId);

  for (const verification of run.verifications) {
    const event = input.events.find((candidate) =>
      candidate.type === "verification.completed" &&
      candidate.payload.verificationId === verification.result.verificationId,
    );
    if (
      event === undefined ||
      event.payload.suiteId !== verification.result.suiteId ||
      event.payload.suiteHash !== verification.result.suiteHash ||
      event.payload.repositoryRevision !== verification.result.repositoryRevision ||
      event.payload.status !== verification.result.status ||
      event.payload.resultArtifactId !== verification.resultArtifact.artifactId ||
      event.payload.resultContentHash !== verification.resultArtifact.contentHash
    ) fail("Managed run verification 결과와 완료 event가 다릅니다.");
    eventIds.push(event.eventId);
  }

  const generations = new Set(injected.map((evidence) => evidence.contextGeneration));
  if (generations.size !== 1 || !generations.has(run.contextGeneration)) {
    fail("Provider 결과가 생성된 뒤 context generation이 무효화되었습니다.");
  }

  for (const publication of input.sharedContextPublications) {
    if (!validateSchema("sharedContext", publication).valid) {
      fail("Shared context publication이 schema를 통과하지 못했습니다.");
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
      fail("Shared context 원문이 현재 역할의 E2/E3에 없습니다.");
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
