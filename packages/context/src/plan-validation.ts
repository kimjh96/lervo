import { contextScopesEqual, type ContextEvidence } from "@lervo/schemas";

import {
  type ContextPlan,
  ContextPreparationError,
  type PlannedContextDocument,
} from "./types.js";

function invalid(message: string): never {
  throw new ContextPreparationError("invalid_context_plan", message);
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
      item.path === document.path,
  );
  if (!discovered) {
    invalid(`${document.documentId}의 E0 discovery가 plan에 없습니다.`);
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
        item.sessionId === plan.coordinates.sessionId,
    );
    if (!selected) {
      invalid(`${document.documentId}의 E1 선택 이유 ${reason.ruleId}이 plan에 없습니다.`);
    }
  }
}

function validateRecommendationEvidence(plan: ContextPlan): void {
  const recommendedEvidence = plan.evidence.filter((item) => item.state === "recommended");
  const recommendations = new Map(
    recommendedEvidence.map((item) => [item.recommendationId, item]),
  );
  if (recommendations.size !== recommendedEvidence.length) {
    invalid("Context plan에 중복 검색 추천 evidence가 있습니다.");
  }
  for (const recommendation of recommendations.values()) {
    const discovered = plan.evidence.some(
      (item) => item.state === "discovered" && item.documentId === recommendation.documentId,
    );
    if (!discovered) invalid(`검색 추천 문서의 E0 discovery가 없습니다: ${recommendation.documentId}`);
  }
  for (const document of plan.documents) {
    for (const reason of document.reasons) {
      if (reason.reasonCode !== "search_recommendation") continue;
      const prefix = "search_recommendation:";
      const recommendation = reason.ruleId.startsWith(prefix)
        ? recommendations.get(reason.ruleId.slice(prefix.length))
        : undefined;
      if (recommendation === undefined || recommendation.documentId !== document.documentId ||
        recommendation.sourceContentHash !== document.expectedContentHash) {
        invalid(`검색 추천 선택 근거가 plan 문서와 다릅니다: ${document.documentId}`);
      }
    }
  }
}

export function validateContextPlanForLoading(plan: ContextPlan): void {
  const documentIds = new Set<string>();
  const paths = new Set<string>();
  for (const document of plan.documents) {
    if (documentIds.has(document.documentId) || paths.has(document.path)) {
      invalid(`Context plan에 중복 문서가 있습니다: ${document.documentId}`);
    }
    if (document.reasons.length === 0) {
      invalid(`${document.documentId}에 선택 이유가 없습니다.`);
    }
    documentIds.add(document.documentId);
    paths.add(document.path);
  }

  for (const evidence of plan.evidence) {
    if (evidence.state !== "discovered" && evidence.state !== "recommended" &&
      evidence.state !== "selected") {
      invalid(`Context plan에는 discovery·recommendation·E1 evidence만 포함할 수 있습니다: ${evidence.receiptId}`);
    }
    if (
      evidence.projectId !== plan.coordinates.projectId ||
      evidence.runId !== plan.coordinates.runId ||
      evidence.sessionId !== plan.coordinates.sessionId
    ) {
      invalid(`Context plan evidence의 run/session 좌표가 다릅니다: ${evidence.receiptId}`);
    }
    if (evidence.state === "selected") {
      const document = plan.documents.find(
        (candidate) => candidate.documentId === evidence.documentId,
      );
      if (!document) {
        invalid(`선택 evidence가 plan에 없는 문서를 가리킵니다: ${evidence.documentId}`);
      }
      const reasonExists = document.reasons.some(
        (reason) =>
          reason.reasonCode === evidence.reasonCode && reason.ruleId === evidence.ruleId,
      );
      if (
        !reasonExists ||
        evidence.required !== document.required ||
        !contextScopesEqual(evidence.scope, document.scope)
      ) {
        invalid(`선택 evidence가 plan의 선택 이유와 다릅니다: ${evidence.receiptId}`);
      }
    }
  }

  for (const document of plan.documents) {
    validateDocumentEvidence(plan, document, plan.evidence);
  }
  validateRecommendationEvidence(plan);
}
