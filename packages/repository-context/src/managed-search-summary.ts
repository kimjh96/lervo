import type { GraphDocumentRecommendation } from "@lervo/context";
import type { ContextEvidence } from "@lervo/schemas";

export interface ManagedSearchContextSummary {
  attemptId: string;
  knowledgeAttemptId: string;
  recommendedDocuments: number;
  selectedDocuments: number;
  selectedDocumentIds: string[];
  recommendedKnowledgeConcepts: number;
  selectedKnowledgeConcepts: number;
  selectedKnowledgeConceptIds: string[];
  recommendedGraphDocuments: number;
  selectedGraphDocuments: number;
  referencedDocuments: number;
  referencedDocumentIds: string[];
}

export function summarizeManagedSearchContext(
  attemptId: string,
  knowledgeAttemptId: string,
  evidence: readonly ContextEvidence[],
  graphRecommendations: readonly GraphDocumentRecommendation[] = [],
): ManagedSearchContextSummary {
  const recommendedDocumentIds = new Set(
    evidence.filter((item) => item.state === "recommended").map((item) => item.documentId),
  );
  const selectedDocumentIds = [
    ...new Set(
      evidence
        .filter((item) => item.state === "selected" && item.reasonCode === "search_recommendation")
        .map((item) => item.documentId),
    ),
  ].sort();
  const selectedKnowledgeConceptIds = [
    ...new Set(
      evidence
        .filter((item) => item.state === "selected" && item.reasonCode === "search_recommendation")
        .flatMap((item) =>
          item.knowledgeContext === undefined ? [] : [item.knowledgeContext.conceptId],
        ),
    ),
  ].sort();
  const recommendedKnowledgeConceptIds = new Set(
    evidence
      .filter((item) => item.state === "recommended")
      .flatMap((item) =>
        item.knowledgeContext === undefined ? [] : [item.knowledgeContext.conceptId],
      ),
  );
  const referencedDocumentIds = [
    ...new Set(
      evidence.filter((item) => item.state === "referenced").map((item) => item.documentId),
    ),
  ].sort();
  return {
    attemptId,
    knowledgeAttemptId,
    recommendedDocuments: recommendedDocumentIds.size,
    selectedDocuments: selectedDocumentIds.length,
    selectedDocumentIds,
    recommendedKnowledgeConcepts: recommendedKnowledgeConceptIds.size,
    selectedKnowledgeConcepts: selectedKnowledgeConceptIds.length,
    selectedKnowledgeConceptIds,
    recommendedGraphDocuments: graphRecommendations.length,
    selectedGraphDocuments: graphRecommendations.filter((item) => item.selected).length,
    referencedDocuments: referencedDocumentIds.length,
    referencedDocumentIds,
  };
}
