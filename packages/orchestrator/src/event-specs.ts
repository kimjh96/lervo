import type { LoadedContext } from "@lervo/context";
import type { InjectedContext } from "@lervo/context-delivery";
import type { ContextInvalidation } from "@lervo/context";
import type { CapabilityDecision } from "@lervo/schemas";

import type { FileChangeRecord } from "./types.js";
import type { ManagedEventSpec } from "./telemetry.js";
import { recommendedContextEventSpecs } from "./recommendation-event-spec.js";

const systemActor = { kind: "system" } as const;

export function preparedContextEventSpecs(loaded: LoadedContext): ManagedEventSpec[] {
  const recommended = recommendedContextEventSpecs(loaded);
  const selected = loaded.plan.evidence
    .filter((evidence) => evidence.state === "selected")
    .map((evidence): ManagedEventSpec => ({
      type: "context.selected",
      occurredAt: evidence.recordedAt,
      actor: systemActor,
      payload: {
        origin: "managed_turn",
        documentId: evidence.documentId,
        reasonCode: evidence.reasonCode,
        ruleId: evidence.ruleId,
        required: evidence.required,
        scope: evidence.scope,
        ...(evidence.knowledgeContext === undefined
          ? {}
          : { knowledgeContext: structuredClone(evidence.knowledgeContext) }),
      },
    }));
  const loadedEvents = loaded.evidence
    .filter((evidence) => evidence.state === "loaded")
    .map((evidence): ManagedEventSpec => ({
      type: "document.loaded",
      occurredAt: evidence.recordedAt,
      actor: systemActor,
      payload: {
        evidenceReceiptId: evidence.receiptId,
        documentId: evidence.documentId,
        contentHash: evidence.contentHash,
        byteCount: evidence.byteCount,
        scope: evidence.scope,
        sourceRevision: evidence.sourceRevision,
        ...(evidence.knowledgeContext === undefined
          ? {}
          : { knowledgeContext: structuredClone(evidence.knowledgeContext) }),
      },
    }));
  return [...recommended, ...selected, ...loadedEvents];
}

export function injectedContextEventSpec(injected: InjectedContext): ManagedEventSpec {
  return {
    type: "context.injected",
    occurredAt: injected.receipt.acceptedAt,
    actor: { kind: "provider", provider: injected.receipt.provider },
    payload: {
      receiptId: injected.receipt.receiptId,
      evidenceReceiptIds: injected.e3Evidence.map((evidence) => evidence.receiptId),
      envelopeId: injected.envelope.envelopeId,
      documentIds: injected.envelope.documents.map((document) => document.documentId),
      targetTurnId: injected.envelope.targetTurnId,
      contextGeneration: injected.envelope.contextGeneration,
      adapterId: injected.receipt.adapterId,
      providerSessionId: injected.receipt.providerSessionId,
      documents: injected.e3Evidence.map((evidence) => ({
        evidenceReceiptId: evidence.receiptId,
        documentId: evidence.documentId,
        contentHash: evidence.contentHash,
        scope: evidence.scope,
      })),
    },
  };
}

export function writeCapabilityEventSpecs(input: {
  targetDigest: string;
  risk: string;
  occurredAt: string;
  decision: CapabilityDecision;
  approvalId?: string | null;
  policyRuleId?: string;
}): [ManagedEventSpec, ManagedEventSpec] {
  return [
    {
      type: "capability.requested",
      occurredAt: input.occurredAt,
      actor: systemActor,
      payload: {
        capability: "filesystem.write",
        targetDigest: input.targetDigest,
        risk: input.risk,
      },
    },
    {
      type: "capability.decided",
      occurredAt: input.occurredAt,
      actor: systemActor,
      payload: {
        capability: "filesystem.write",
        decision: input.decision,
        policyRuleId: input.policyRuleId ?? "managed_context_e3",
        approvalId: input.approvalId ?? null,
      },
    },
  ];
}

export function invalidationEventSpecs(input: {
  invalidations: readonly Pick<ContextInvalidation, "documentId" | "reason">[];
  occurredAt: string;
  contextGeneration: number;
}): ManagedEventSpec[] {
  const byReason = new Map<string, string[]>();
  for (const invalidation of input.invalidations) {
    const documentIds = byReason.get(invalidation.reason) ?? [];
    documentIds.push(invalidation.documentId);
    byReason.set(invalidation.reason, documentIds);
  }
  return [...byReason.entries()].map(([reason, documentIds]) => ({
    type: "context.invalidated",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      documentIds: [...new Set(documentIds)].sort(),
      reason,
      contextGeneration: input.contextGeneration,
    },
  }));
}

export function runtimeInvalidationEventSpec(input: {
  documentIds: readonly string[];
  reason:
    | "managed_file_changed"
    | "file_change_unverified"
    | "context_compacted"
    | "session_restarted"
    | "snapshot_validation_failed";
  occurredAt: string;
  contextGeneration: number;
}): ManagedEventSpec {
  return {
    type: "context.invalidated",
    occurredAt: input.occurredAt,
    actor: systemActor,
    payload: {
      documentIds: [...new Set(input.documentIds)].sort(),
      reason: input.reason,
      contextGeneration: input.contextGeneration,
    },
  };
}

export function fileChangedEventSpec(
  input: FileChangeRecord & { normalizedPath: string; provider: string },
): ManagedEventSpec {
  return {
    type: "file.changed",
    occurredAt: input.occurredAt.toISOString(),
    actor: { kind: "agent", provider: input.provider },
    payload: {
      path: input.normalizedPath,
      beforeHash: input.beforeHash,
      afterHash: input.afterHash,
      changeKind: input.changeKind,
    },
  };
}
