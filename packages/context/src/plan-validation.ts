import {
  contextScopesEqual,
  type ContextEvidence,
  type KnowledgeContextMetadata,
} from "@lervo/schemas";

import { type ContextPlan, ContextPreparationError, type PlannedContextDocument } from "./types.js";

function invalid(message: string): never {
  throw new ContextPreparationError("invalid_context_plan", message);
}

function metadataEqual(
  left: KnowledgeContextMetadata | undefined,
  right: KnowledgeContextMetadata | undefined,
): boolean {
  if (left === undefined || right === undefined) return left === right;
  return (
    left.conceptId === right.conceptId &&
    left.assurance === right.assurance &&
    left.freshness === right.freshness &&
    left.sourceSnapshotId === right.sourceSnapshotId &&
    left.impactReportId === right.impactReportId
  );
}

function validateDocumentEvidence(
  plan: ContextPlan,
  document: PlannedContextDocument,
  evidence: readonly ContextEvidence[],
): void {
  const discovered = evidence.some(
    (item) =>
      item.state === "discovered" &&
      item.documentId === document.documentId &&
      item.path === document.path &&
      metadataEqual(item.knowledgeContext, document.knowledgeContext),
  );
  if (!discovered) {
    invalid(`The E0 discovery for ${document.documentId} is missing from the plan.`);
  }
  for (const reason of document.reasons) {
    const selected = evidence.some(
      (item) =>
        item.state === "selected" &&
        item.documentId === document.documentId &&
        item.required === document.required &&
        contextScopesEqual(item.scope, document.scope) &&
        item.reasonCode === reason.reasonCode &&
        item.ruleId === reason.ruleId &&
        item.projectId === plan.coordinates.projectId &&
        item.runId === plan.coordinates.runId &&
        item.sessionId === plan.coordinates.sessionId &&
        metadataEqual(item.knowledgeContext, document.knowledgeContext),
    );
    if (!selected) {
      invalid(
        `The E1 selection reason ${reason.ruleId} for ${document.documentId} is missing from the plan.`,
      );
    }
  }
}

function validateRecommendationEvidence(plan: ContextPlan): void {
  const recommendedEvidence = plan.evidence.filter((item) => item.state === "recommended");
  const recommendations = new Map(recommendedEvidence.map((item) => [item.recommendationId, item]));
  if (recommendations.size !== recommendedEvidence.length) {
    invalid("The context plan contains duplicate search recommendation evidence.");
  }
  for (const recommendation of recommendations.values()) {
    const discovered = plan.evidence.some(
      (item) =>
        item.state === "discovered" &&
        item.documentId === recommendation.documentId &&
        metadataEqual(item.knowledgeContext, recommendation.knowledgeContext),
    );
    if (!discovered)
      invalid(`The search-recommended document has no E0 discovery: ${recommendation.documentId}`);
  }
  for (const document of plan.documents) {
    for (const reason of document.reasons) {
      if (reason.reasonCode !== "search_recommendation") continue;
      const prefix = "search_recommendation:";
      const recommendation = reason.ruleId.startsWith(prefix)
        ? recommendations.get(reason.ruleId.slice(prefix.length))
        : undefined;
      if (
        recommendation === undefined ||
        recommendation.documentId !== document.documentId ||
        recommendation.sourceContentHash !== document.expectedContentHash ||
        !metadataEqual(recommendation.knowledgeContext, document.knowledgeContext)
      ) {
        invalid(
          `The search recommendation selection evidence differs from the plan document: ${document.documentId}`,
        );
      }
    }
  }
}

export function validateContextPlanForLoading(plan: ContextPlan): void {
  const documentIds = new Set<string>();
  const paths = new Set<string>();
  for (const document of plan.documents) {
    if (documentIds.has(document.documentId) || paths.has(document.path)) {
      invalid(`The context plan contains a duplicate document: ${document.documentId}`);
    }
    if (document.reasons.length === 0) {
      invalid(`${document.documentId} has no selection reason.`);
    }
    documentIds.add(document.documentId);
    paths.add(document.path);
  }

  for (const evidence of plan.evidence) {
    if (
      evidence.state !== "discovered" &&
      evidence.state !== "recommended" &&
      evidence.state !== "selected"
    ) {
      invalid(
        `A context plan can contain only discovery, recommendation, and E1 evidence: ${evidence.receiptId}`,
      );
    }
    if (
      evidence.projectId !== plan.coordinates.projectId ||
      evidence.runId !== plan.coordinates.runId ||
      evidence.sessionId !== plan.coordinates.sessionId
    ) {
      invalid(
        `The context plan evidence has different run/session coordinates: ${evidence.receiptId}`,
      );
    }
    if (evidence.state === "selected") {
      const document = plan.documents.find(
        (candidate) => candidate.documentId === evidence.documentId,
      );
      if (!document) {
        invalid(
          `The selection evidence references a document not in the plan: ${evidence.documentId}`,
        );
      }
      const reasonExists = document.reasons.some(
        (reason) => reason.reasonCode === evidence.reasonCode && reason.ruleId === evidence.ruleId,
      );
      if (
        !reasonExists ||
        evidence.required !== document.required ||
        !contextScopesEqual(evidence.scope, document.scope) ||
        !metadataEqual(evidence.knowledgeContext, document.knowledgeContext)
      ) {
        invalid(
          `The selection evidence differs from the plan selection reason: ${evidence.receiptId}`,
        );
      }
    }
  }

  for (const document of plan.documents) {
    validateDocumentEvidence(plan, document, plan.evidence);
  }
  validateRecommendationEvidence(plan);
}
