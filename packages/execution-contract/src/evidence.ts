import {
  validateSchema,
  type EventEnvelope,
  type SharedContextPublication,
} from "@lervo/schemas";

import type { ManagedProviderRunResult } from "./types.js";

export interface ManagedProviderRunEvidenceBinding {
  contextGeneration: number;
  loadedReceiptIds: string[];
  injectedReceiptIds: string[];
  sharedContextIds: string[];
  evidenceEventIds: string[];
}

export class ManagedProviderRunEvidenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManagedProviderRunEvidenceError";
  }
}

function fail(message: string): never {
  throw new ManagedProviderRunEvidenceError(message);
}

function sameStringArray(actual: unknown, expected: readonly string[]): boolean {
  return Array.isArray(actual) && actual.length === expected.length &&
    actual.every((value, index) => value === expected[index]);
}

export function validateManagedProviderRunEvidence(input: {
  run: ManagedProviderRunResult;
  events: readonly EventEnvelope[];
  sharedContextPublications: readonly SharedContextPublication[];
}): ManagedProviderRunEvidenceBinding {
  const { run } = input;
  const loaded = run.contextEvidence.filter((evidence) => evidence.state === "loaded");
  const injected = run.contextEvidence.filter((evidence) => evidence.state === "injected");
  const referenced = run.contextEvidence.filter((evidence) => evidence.state === "referenced");
  if (loaded.length === 0 || injected.length === 0) fail("The managed run has no E2 or E3 context evidence.");
  if (run.session.providerSessionId !== run.turn.providerSessionId) {
    fail("The managed run session and turn coordinates differ.");
  }
  for (const evidence of [...loaded, ...injected]) {
    if (evidence.projectId !== run.session.projectId || evidence.runId !== run.session.runId ||
      evidence.sessionId !== run.session.sessionId) fail("The context evidence does not match the managed run coordinates.");
  }

  const eventIds: string[] = [];
  for (const evidence of loaded) {
    const event = input.events.find((candidate) => candidate.type === "document.loaded" &&
      candidate.payload.evidenceReceiptId === evidence.receiptId);
    if (event === undefined || event.projectId !== evidence.projectId ||
      event.runId !== evidence.runId || event.sessionId !== evidence.sessionId ||
      event.payload.documentId !== evidence.documentId ||
      event.payload.contentHash !== evidence.contentHash ||
      event.payload.byteCount !== evidence.byteCount ||
      event.payload.sourceRevision !== evidence.sourceRevision) {
      fail("The E2 context receipt differs from the document.loaded event.");
    }
    eventIds.push(event.eventId);
  }

  const injectedByEvent = new Map<EventEnvelope, typeof injected>();
  for (const evidence of injected) {
    const event = input.events.find((candidate) => candidate.type === "context.injected" &&
      Array.isArray(candidate.payload.evidenceReceiptIds) &&
      candidate.payload.evidenceReceiptIds.includes(evidence.receiptId));
    if (event === undefined || event.projectId !== evidence.projectId ||
      event.runId !== evidence.runId || event.sessionId !== evidence.sessionId ||
      event.actor.provider !== evidence.provider ||
      event.payload.receiptId !== evidence.adapterReceiptId ||
      event.payload.envelopeId !== evidence.envelopeId ||
      event.payload.targetTurnId !== evidence.targetTurnId ||
      event.payload.contextGeneration !== evidence.contextGeneration ||
      !Array.isArray(event.payload.documentIds) ||
      !event.payload.documentIds.includes(evidence.documentId)) {
      fail("The E3 context receipt differs from the context.injected event.");
    }
    if (Array.isArray(event.payload.documents)) {
      const document = event.payload.documents.find((candidate) =>
        typeof candidate === "object" && candidate !== null &&
        (candidate as Record<string, unknown>).evidenceReceiptId === evidence.receiptId
      ) as Record<string, unknown> | undefined;
      if (
        document === undefined ||
        document.documentId !== evidence.documentId ||
        document.contentHash !== evidence.contentHash ||
        JSON.stringify(document.scope) !== JSON.stringify(evidence.scope) ||
        event.payload.adapterId !== evidence.adapterId ||
        event.payload.providerSessionId !== evidence.providerSessionId
      ) fail("The enhanced E3 event binding differs from the injected context evidence.");
    }
    const group = injectedByEvent.get(event) ?? [];
    group.push(evidence);
    injectedByEvent.set(event, group);
  }

  const resultEvents = input.events.filter((event) => event.type === "adapter.result.captured");
  if (resultEvents.length !== 1) fail("The managed run must have exactly one captured adapter result event.");
  const resultEvent = resultEvents[0]!;
  if (
    resultEvent.actor.provider !== run.session.provider ||
    resultEvent.payload.adapterId !== run.session.adapterId ||
    resultEvent.payload.providerSessionId !== run.session.providerSessionId ||
    resultEvent.payload.targetTurnId !== run.turn.targetTurnId ||
    resultEvent.payload.providerTurnId !== run.turn.providerTurnId ||
    resultEvent.payload.resultDigest !== run.resultArtifact.contentHash ||
    resultEvent.payload.byteCount !== run.resultArtifact.byteCount ||
    resultEvent.payload.mediaType !== run.resultArtifact.mediaType ||
    resultEvent.payload.referenceTelemetry !== "supported"
  ) fail("The captured adapter result differs from the managed result artifact or turn.");
  eventIds.push(resultEvent.eventId);

  for (const evidence of referenced) {
    const event = input.events.find((candidate) => candidate.type === "context.referenced" &&
      candidate.payload.evidenceReceiptId === evidence.receiptId);
    const injectedEvidence = injected.find((candidate) =>
      candidate.receiptId === evidence.injectedEvidenceReceiptId);
    if (
      event === undefined || injectedEvidence === undefined ||
      event.projectId !== evidence.projectId || event.runId !== evidence.runId ||
      event.sessionId !== evidence.sessionId || event.actor.provider !== evidence.provider ||
      event.payload.sourceEventId !== resultEvent.eventId ||
      event.payload.documentId !== evidence.documentId ||
      event.payload.contentHash !== evidence.contentHash ||
      event.payload.injectedEvidenceReceiptId !== injectedEvidence.receiptId ||
      event.payload.adapterReceiptId !== injectedEvidence.adapterReceiptId ||
      event.payload.targetTurnId !== run.turn.targetTurnId ||
      event.payload.providerTurnId !== run.turn.providerTurnId ||
      event.payload.contextGeneration !== injectedEvidence.contextGeneration ||
      event.payload.citation !== evidence.citation
    ) fail("The managed E4 receipt differs from its injected version or source result event.");
    eventIds.push(event.eventId);
  }
  for (const [event, evidence] of injectedByEvent) {
    if (!sameStringArray(event.payload.evidenceReceiptIds,
      evidence.map((item) => item.receiptId))) {
      fail("The context.injected event E3 receipt list differs from the actual list.");
    }
    eventIds.push(event.eventId);
  }

  const completed = input.events.filter((event) => event.type === "run.completed");
  const expectedArtifactIds = [...new Set([
    run.resultArtifact.artifactId,
    ...run.verifications.map((item) => item.resultArtifact.artifactId),
  ])];
  if (completed.length !== 1 ||
    completed[0]!.payload.resultDigest !== run.resultArtifact.contentHash ||
    completed[0]!.payload.verificationStatus !== run.verificationStatus ||
    !sameStringArray(completed[0]!.payload.artifactIds, expectedArtifactIds)) {
    fail("The managed run completion event differs from the result artifact.");
  }
  eventIds.push(completed[0]!.eventId);

  for (const verification of run.verifications) {
    const event = input.events.find((candidate) => candidate.type === "verification.completed" &&
      candidate.payload.verificationId === verification.result.verificationId);
    if (event === undefined || event.payload.suiteId !== verification.result.suiteId ||
      event.payload.suiteHash !== verification.result.suiteHash ||
      event.payload.repositoryRevision !== verification.result.repositoryRevision ||
      event.payload.status !== verification.result.status ||
      event.payload.resultArtifactId !== verification.resultArtifact.artifactId ||
      event.payload.resultContentHash !== verification.resultArtifact.contentHash) {
      fail("The managed run verification result differs from the completion event.");
    }
    eventIds.push(event.eventId);
  }

  const generations = new Set(injected.map((evidence) => evidence.contextGeneration));
  if (generations.size !== 1 || !generations.has(run.contextGeneration)) {
    fail("The context generation was invalidated after the provider result was produced.");
  }
  for (const publication of input.sharedContextPublications) {
    if (!validateSchema("sharedContext", publication).valid) fail("The shared-context publication does not satisfy its schema.");
    const loadedEvidence = loaded.find((evidence) => evidence.documentId === publication.documentId &&
      evidence.contentHash === publication.contentHash);
    const injectedEvidence = injected.find((evidence) => evidence.documentId === publication.documentId &&
      evidence.contentHash === publication.contentHash);
    if (loadedEvidence === undefined || injectedEvidence === undefined) {
      fail("The shared-context source is absent from the current role's E2/E3 evidence.");
    }
  }
  return {
    contextGeneration: run.contextGeneration,
    loadedReceiptIds: loaded.map((evidence) => evidence.receiptId),
    injectedReceiptIds: injected.map((evidence) => evidence.receiptId),
    sharedContextIds: input.sharedContextPublications.map((item) => item.sharedContextId),
    evidenceEventIds: input.events.filter((event) => eventIds.includes(event.eventId))
      .sort((left, right) => left.seq - right.seq).map((event) => event.eventId),
  };
}
