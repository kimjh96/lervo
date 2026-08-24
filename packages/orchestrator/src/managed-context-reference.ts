import { randomUUID } from "node:crypto";

import {
  managedContextPublicationContent,
  managedContextReferenceToken,
  referencedManagedContextDocuments,
} from "@lervo/adapter-contract";
import type { InjectedContext } from "@lervo/context-delivery";
import {
  cloneContextScope,
  type AdapterSession,
  type AdapterTurn,
  type AdapterTurnResult,
  type ContextEvidence,
  validateSchema,
} from "@lervo/schemas";

import { ManagedProviderRunError } from "./provider-run-types.js";
import type { ManagedEventSpec } from "./telemetry.js";

type ReferencedEvidence = Extract<ContextEvidence, { state: "referenced" }>;

function defaultReceiptId(): string {
  return `ctx_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export function managedResultReferenceSpecs(input: {
  sourceEventId: string;
  session: AdapterSession;
  turn: AdapterTurn;
  result: AdapterTurnResult;
  injected: InjectedContext;
  createEvidenceReceiptId?: () => string;
}): { specs: ManagedEventSpec[]; evidence: ContextEvidence[]; publicationContent: string } {
  const referenced = referencedManagedContextDocuments(
    input.result.content,
    input.injected.envelope.documents,
  );
  const createReceiptId = input.createEvidenceReceiptId ?? defaultReceiptId;
  const evidence: ReferencedEvidence[] = referenced.map((document) => {
    const injectedEvidence = input.injected.e3Evidence.find((candidate) =>
      candidate.documentId === document.documentId &&
      candidate.contentHash === document.contentHash
    );
    if (injectedEvidence === undefined) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "A managed output citation does not match the injected document version.",
      );
    }
    let evidenceReceiptId: string;
    try {
      evidenceReceiptId = createReceiptId();
    } catch (error) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "Could not create the managed E4 evidence receipt ID.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
    const item: ReferencedEvidence = {
      receiptId: evidenceReceiptId,
      projectId: input.session.projectId,
      runId: input.session.runId,
      sessionId: input.session.sessionId,
      documentId: document.documentId,
      state: "referenced",
      recordedAt: input.result.producedAt,
      contentHash: document.contentHash,
      scope: cloneContextScope(document.scope),
      provider: input.session.provider,
      providerSessionId: input.session.providerSessionId,
      targetTurnId: input.turn.targetTurnId,
      providerTurnId: input.turn.providerTurnId,
      contextGeneration: input.injected.envelope.contextGeneration,
      adapterReceiptId: input.injected.receipt.receiptId,
      injectedEvidenceReceiptId: injectedEvidence.receiptId,
      sourceEventId: input.sourceEventId,
      referenceKind: "output_citation",
      citation: managedContextReferenceToken(document),
      ...(document.knowledgeContext === undefined
        ? {}
        : { knowledgeContext: structuredClone(document.knowledgeContext) }),
    };
    if (!validateSchema("contextEvidence", item).valid) {
      throw new ManagedProviderRunError(
        "contract_validation_failed",
        "Could not create valid managed E4 context evidence.",
      );
    }
    return item;
  });

  return {
    specs: [
      {
        eventId: input.sourceEventId,
        type: "adapter.result.captured",
        occurredAt: input.result.producedAt,
        actor: { kind: "provider", provider: input.session.provider },
        payload: {
          adapterId: input.session.adapterId,
          providerSessionId: input.session.providerSessionId,
          targetTurnId: input.turn.targetTurnId,
          providerTurnId: input.turn.providerTurnId,
          resultDigest: input.result.contentHash,
          byteCount: input.result.byteCount,
          mediaType: input.result.mediaType,
          referenceTelemetry: "supported",
        },
      },
      ...evidence.map((item): ManagedEventSpec => ({
        type: "context.referenced",
        occurredAt: item.recordedAt,
        actor: { kind: "provider", provider: input.session.provider },
        payload: {
          evidenceReceiptId: item.receiptId,
          injectedEvidenceReceiptId: item.injectedEvidenceReceiptId,
          adapterReceiptId: item.adapterReceiptId,
          sourceEventId: item.sourceEventId,
          documentId: item.documentId,
          contentHash: item.contentHash,
          scope: item.scope,
          provider: item.provider,
          providerSessionId: item.providerSessionId,
          targetTurnId: item.targetTurnId,
          providerTurnId: item.providerTurnId,
          contextGeneration: item.contextGeneration,
          referenceKind: item.referenceKind,
          citation: item.citation,
        },
      })),
    ],
    evidence,
    publicationContent: managedContextPublicationContent(
      input.result.content,
      input.injected.envelope.documents,
    ),
  };
}
