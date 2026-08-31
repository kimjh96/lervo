import type { LoadedContext } from "@lervo/context";

import type { ManagedEventSpec } from "./telemetry.js";

export function recommendedContextEventSpecs(loaded: LoadedContext): ManagedEventSpec[] {
  return loaded.plan.evidence
    .filter((evidence) => evidence.state === "recommended")
    .map((evidence) => ({
      type: "context.recommended",
      occurredAt: evidence.recordedAt,
      actor: { kind: "system" },
      payload: {
        recommendationId: evidence.recommendationId,
        batchId: evidence.batchId,
        sourceAttemptId: evidence.sourceAttemptId,
        engineId: evidence.engineId,
        engineVersion: evidence.engineVersion,
        selectionTransitionId: evidence.selectionTransitionId,
        ...(evidence.productQualificationId === undefined
          ? {}
          : { productQualificationId: evidence.productQualificationId }),
        indexId: evidence.indexId,
        resultSetHash: evidence.resultSetHash,
        documentId: evidence.documentId,
        sourceContentHash: evidence.sourceContentHash,
        rank: evidence.rank,
        score: evidence.score,
        selectionPolicyId: evidence.selectionPolicyId,
        selectionPolicyVersion: evidence.selectionPolicyVersion,
        selectionMaximum: evidence.selectionMaximum,
        ...(evidence.knowledgeContext === undefined
          ? {}
          : { knowledgeContext: structuredClone(evidence.knowledgeContext) }),
      },
    }));
}
