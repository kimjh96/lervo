import type {
  DocumentNormalizationCandidate,
  DocumentNormalizationCandidateItem,
} from "@lervo/repository-knowledge";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

const checks = [
  "meaning",
  "requirements",
  "examples",
  "links",
  "lifecycle",
  "protectedRegions",
  "skillIdentity",
  "resources",
] as const;

export const normalizationReviewResponseSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidateId: { type: "string" },
    decisions: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          operationId: { type: "string" },
          sourceContentHash: { type: "string" },
          decision: { enum: ["approve", "reject"] },
          rationale: { type: "string", minLength: 40, maxLength: 4_096 },
          checks: {
            type: "object",
            additionalProperties: false,
            properties: Object.fromEntries(checks.map((check) => [check, { type: "boolean" }])),
            required: checks,
          },
          unitReviews: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                unitVersionId: { type: "string" },
                outputHashes: { type: "array", items: { type: "string" } },
                rationale: { type: "string", minLength: 20, maxLength: 2_048 },
              },
              required: ["unitVersionId", "outputHashes", "rationale"],
            },
          },
        },
        required: [
          "operationId",
          "sourceContentHash",
          "decision",
          "rationale",
          "checks",
          "unitReviews",
        ],
      },
    },
  },
  required: ["candidateId", "decisions"],
} as const;

export interface NormalizationSemanticDecision {
  operationId: string;
  sourceContentHash: string;
  decision: "approve" | "reject";
  rationale: string;
  checks: Record<(typeof checks)[number], boolean>;
  unitReviews: { unitVersionId: string; outputHashes: string[]; rationale: string }[];
}

function validDecision(
  item: DocumentNormalizationCandidateItem,
  decision: NormalizationSemanticDecision,
): boolean {
  if (
    decision === null ||
    typeof decision !== "object" ||
    decision.operationId !== item.operationId ||
    decision.sourceContentHash !== item.sourceContentHash ||
    !["approve", "reject"].includes(decision.decision) ||
    typeof decision.rationale !== "string" ||
    decision.rationale.trim().length < 40 ||
    decision.rationale.length > 4_096 ||
    decision.checks === null ||
    typeof decision.checks !== "object" ||
    !checks.every((check) => typeof decision.checks[check] === "boolean") ||
    !Array.isArray(decision.unitReviews)
  )
    return false;
  if (decision.decision === "reject") return true;
  if (
    !checks.every((check) => decision.checks[check]) ||
    decision.unitReviews.length !== item.sourceUnitVersionIds.length ||
    new Set(decision.unitReviews.map((review) => review.unitVersionId)).size !==
      item.sourceUnitVersionIds.length
  )
    return false;
  return decision.unitReviews.every(
    (review) =>
      item.sourceUnitVersionIds.includes(review.unitVersionId) &&
      typeof review.rationale === "string" &&
      review.rationale.trim().length >= 20 &&
      review.rationale.length <= 2_048 &&
      Array.isArray(review.outputHashes) &&
      review.outputHashes.length > 0 &&
      new Set(review.outputHashes).size === review.outputHashes.length &&
      review.outputHashes.every((hash) =>
        item.outputs.some(
          (output) =>
            output.contentHash === hash &&
            output.coveredUnitVersionIds.includes(review.unitVersionId),
        ),
      ),
  );
}

/** Semantic approvals bind every exact source unit and output; the generator cannot self-approve. */
export function parseNormalizationSemanticReview(
  value: unknown,
  candidate: DocumentNormalizationCandidate,
): NormalizationSemanticDecision[] {
  const response = value as {
    candidateId?: unknown;
    decisions?: NormalizationSemanticDecision[];
  } | null;
  if (
    response?.candidateId !== candidate.candidateId ||
    !Array.isArray(response.decisions) ||
    response.decisions.length !== candidate.items.length ||
    new Set(response.decisions.map((decision) => decision?.operationId)).size !==
      candidate.items.length ||
    candidate.items.some(
      (item) =>
        !validDecision(
          item,
          response.decisions!.find((decision) => decision?.operationId === item.operationId)!,
        ),
    )
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
  return response.decisions;
}
