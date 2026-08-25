import { ContextSelectionAccumulator } from "./accumulator.js";
import {
  type ContextDocumentCandidate,
  type GraphDocumentRecommendation,
  ContextPreparationError,
} from "./types.js";

const MAXIMUM_RECOMMENDATIONS = 5;
const MAXIMUM_SELECTIONS = 2;

function invalid(message: string): never {
  throw new ContextPreparationError("invalid_graph_recommendation", message);
}

export function applyGraphRecommendations(input: {
  recommendations: readonly GraphDocumentRecommendation[];
  candidates: ReadonlyMap<string, ContextDocumentCandidate>;
  accumulator: ContextSelectionAccumulator;
}): readonly GraphDocumentRecommendation[] {
  if (input.recommendations.length > MAXIMUM_RECOMMENDATIONS) {
    invalid("The knowledge-graph recommendation limit was exceeded.");
  }
  const recommendationIds = new Set<string>();
  let selected = 0;
  for (const [index, recommendation] of input.recommendations.entries()) {
    if (
      recommendation.schemaVersion !== 1 ||
      recommendation.rank !== index + 1 ||
      recommendationIds.has(recommendation.recommendationId) ||
      !/^krelproj_[a-f0-9]{24}$/.test(recommendation.projectionId) ||
      !/^krelrec_[a-f0-9]{24}$/.test(recommendation.recommendationId) ||
      !/^sha256:[a-f0-9]{64}$/.test(recommendation.sourceContentHash)
    ) {
      invalid("The knowledge-graph recommendation coordinates are invalid.");
    }
    recommendationIds.add(recommendation.recommendationId);
    const candidate = input.candidates.get(recommendation.documentId);
    if (
      candidate === undefined ||
      candidate.path !== recommendation.path ||
      candidate.knowledgeContext?.conceptId !== recommendation.targetConceptId ||
      candidate.knowledgeContext.sourceSnapshotId !== recommendation.sourceSnapshotId ||
      candidate.knowledgeContext.impactReportId !== recommendation.impactReportId
    ) {
      invalid("The knowledge-graph recommendation does not match a registered current document.");
    }
    input.accumulator.discover(candidate);
    if (!recommendation.selected) continue;
    selected += 1;
    if (selected > MAXIMUM_SELECTIONS) {
      invalid("The knowledge-graph selection limit was exceeded.");
    }
    input.accumulator.select({
      candidate,
      reason: {
        reasonCode: "graph_recommendation",
        ruleId: `graph_recommendation:${recommendation.recommendationId}`,
      },
      expectedContentHash: recommendation.sourceContentHash,
    });
  }
  return structuredClone(input.recommendations);
}
