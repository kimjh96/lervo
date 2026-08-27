import {
  boundedArray,
  boundedString,
  canonicalDigest,
  fail,
  record,
  uniqueStrings,
} from "./contract-common.mjs";

const reviewCriteria = [
  "naturalistic_prompt",
  "canonical_source_grounding",
  "task_or_category_fit",
  "case_distinctness",
  "context_sufficiency",
  "authority_coherence",
  "fail_closed_behavior",
  "evidence_claim_boundary",
];

const retrievalAttentionReasons = new Set([
  "english_lexical_and_candidate_failure",
  "english_lexical_failure_candidate_recovery",
  "korean_lexical_and_candidate_failure",
  "partial_expected_path_recall_both_languages",
  "english_candidate_rank_regression",
]);

const groundingAttentionReasons = new Set([
  "non_durable_rationale_source_boundary",
  "role_without_task_policy_choice",
  "fresh_clone_roadmap_recovery_boundary",
]);

function subject(value, label, suite, trailingNewline) {
  const item = record(value, label);
  if (item.suiteId !== suite.suiteId) fail(`${label} names a different suite`);
  if (item.suiteDigest !== canonicalDigest(suite, trailingNewline)) {
    fail(`${label} digest is stale`);
  }
}

function attentionIds(value, label, idKey, allowedIds, reasonCodes) {
  return boundedArray(value, label, 1, allowedIds.size).map((value, index) => {
    const item = record(value, `${label}[${index}]`);
    const id = boundedString(item[idKey], `${label}[${index}].${idKey}`, 128);
    if (!allowedIds.has(id)) fail(`${label} references an unknown case`);
    uniqueStrings(
      boundedArray(item.reasonCodes, `${label}[${index}].reasonCodes`, 1, 4),
      `${label}[${index}].reasonCodes`,
      reasonCodes,
    );
    return id;
  });
}

function completePartition(readyIds, attention, expectedIds, label) {
  const combined = [...readyIds, ...attention];
  if (new Set(combined).size !== combined.length) fail(`${label} review repeats a case`);
  if (combined.length !== expectedIds.size || combined.some((caseId) => !expectedIds.has(caseId))) {
    fail(`${label} review does not cover every case exactly once`);
  }
}

export function validateNaturalLanguageCaseReview(value, korean, control, grounding) {
  const review = record(value, "natural-language case review");
  if (
    review.schemaVersion !== 1 ||
    review.reviewId !== "nlreview_repository_natural_language.v1" ||
    review.reviewKind !== "agent_pre_review" ||
    review.provenance !== "verification_authored" ||
    review.reviewStatus !== "pending_human_review" ||
    review.humanApproval !== false
  ) {
    fail("case review overstates human approval or has an invalid header");
  }
  const subjects = record(review.subjects, "case review subjects");
  subject(subjects.koreanRetrieval, "case review Korean subject", korean, false);
  subject(subjects.englishControl, "case review English subject", control, false);
  subject(subjects.grounding, "case review grounding subject", grounding, true);
  const criteria = uniqueStrings(
    boundedArray(review.criteria, "case review criteria", 8, 8),
    "case review criteria",
  );
  if (JSON.stringify(criteria) !== JSON.stringify(reviewCriteria)) {
    fail("case review criteria differ from the reviewed order");
  }

  const retrieval = record(review.retrieval, "retrieval case review");
  const koreanPairs = new Set(korean.cases.map((item) => item.pairId));
  const controlPairs = new Set(control.cases.map((item) => item.pairId));
  if (
    koreanPairs.size !== controlPairs.size ||
    [...koreanPairs].some((pairId) => !controlPairs.has(pairId))
  ) {
    fail("case review subjects are not paired retrieval suites");
  }
  const readyPairs = uniqueStrings(
    boundedArray(retrieval.readyPairIds, "retrieval ready pairs", 1, koreanPairs.size),
    "retrieval ready pairs",
    koreanPairs,
  );
  const attentionPairs = attentionIds(
    retrieval.attention,
    "retrieval attention",
    "pairId",
    koreanPairs,
    retrievalAttentionReasons,
  );
  completePartition(readyPairs, attentionPairs, koreanPairs, "retrieval");
  if (retrieval.humanDecisionRequiredForAll !== true) {
    fail("retrieval review bypasses human decision");
  }

  const groundingReview = record(review.grounding, "grounding case review");
  const groundingIds = new Set(grounding.cases.map((item) => item.caseId));
  const readyGrounding = uniqueStrings(
    boundedArray(groundingReview.readyCaseIds, "grounding ready cases", 1, groundingIds.size),
    "grounding ready cases",
    groundingIds,
  );
  const attentionGrounding = attentionIds(
    groundingReview.attention,
    "grounding attention",
    "caseId",
    groundingIds,
    groundingAttentionReasons,
  );
  completePartition(readyGrounding, attentionGrounding, groundingIds, "grounding");
  if (groundingReview.humanDecisionRequiredForAll !== true) {
    fail("grounding review bypasses human decision");
  }
  return {
    preReviewPairCount: koreanPairs.size,
    preReviewGroundingCaseCount: groundingIds.size,
    preReviewAttentionCount: attentionPairs.length + attentionGrounding.length,
  };
}
