import { contentId } from "./integrity.js";
import {
  ACTOR_ID_PATTERN,
  assertRetrievalPlanTimestamp,
  assertUniqueRetrievalPlanIds,
  BUNDLE_ID_PATTERN,
  invalidRetrievalPlan,
  PLAN_ID_PATTERN,
  POLICY_ID_PATTERN,
  POPULATION_ID_PATTERN,
  REVIEW_ID_PATTERN,
} from "./retrieval-plan-common.js";
import { assertSearchRetrievalPlan } from "./retrieval-plan-definition.js";
import type {
  SearchRetrievalPlanActivationBundle,
  SearchRetrievalPlanPolicy,
  SearchRetrievalPlanReview,
} from "./retrieval-plan-types.js";
import { SHA256_PATTERN } from "./validation.js";

function reviewCore(
  review: SearchRetrievalPlanReview,
): Omit<SearchRetrievalPlanReview, "reviewId"> {
  const { reviewId: _reviewId, ...core } = review;
  return core;
}

export function createSearchRetrievalPlanReview(
  input: Omit<SearchRetrievalPlanReview, "schemaVersion" | "reviewId">,
): SearchRetrievalPlanReview {
  const core = { schemaVersion: 1 as const, ...structuredClone(input) };
  const review = { ...core, reviewId: contentId("srprev", core) };
  assertSearchRetrievalPlanReview(review);
  return review;
}

export function assertSearchRetrievalPlanReview(review: SearchRetrievalPlanReview): void {
  assertRetrievalPlanTimestamp(review.reviewedAt);
  if (
    review.schemaVersion !== 1 ||
    !REVIEW_ID_PATTERN.test(review.reviewId) ||
    !PLAN_ID_PATTERN.test(review.planId) ||
    !ACTOR_ID_PATTERN.test(review.reviewerId) ||
    review.decision !== "activate" ||
    !/^ksnap_[a-f0-9]{24}$/.test(review.corpus.sourceSnapshotId) ||
    !SHA256_PATTERN.test(review.corpus.digest) ||
    !Number.isSafeInteger(review.corpus.documentCount) ||
    review.corpus.documentCount < 1 ||
    !Number.isSafeInteger(review.corpus.byteCount) ||
    review.corpus.byteCount < 1 ||
    review.suite.suiteId.length < 1 ||
    review.suite.suiteId.length > 128 ||
    !SHA256_PATTERN.test(review.suite.bindingHash) ||
    !Number.isSafeInteger(review.suite.cases) ||
    review.suite.cases < 1 ||
    !Number.isSafeInteger(review.suite.repetitions) ||
    review.suite.repetitions < 1 ||
    review.populations.length < 2 ||
    review.populations.length > 8 ||
    new Set(review.populations.map((item) => item.populationId)).size !==
      review.populations.length ||
    review.populations.some(
      (item) =>
        !POPULATION_ID_PATTERN.test(item.populationId) ||
        !/^[a-z][a-z0-9_]{7,127}$/.test(item.reportId) ||
        !SHA256_PATTERN.test(item.reportHash) ||
        !Number.isSafeInteger(item.totalObservations) ||
        item.totalObservations < 1 ||
        item.passedObservations !== item.totalObservations ||
        item.usageComplete !== true ||
        item.projectionFailures !== 0 ||
        item.durationWithinLimit !== true,
    ) ||
    review.engineEvidence.evidencePath.length < 1 ||
    review.engineEvidence.evidencePath.startsWith("/") ||
    review.engineEvidence.evidencePath.includes("..") ||
    !SHA256_PATTERN.test(review.engineEvidence.evidenceHash) ||
    review.engineEvidence.qualityGatePassed !== true ||
    review.engineEvidence.efficiencyGatePassed !== true
  ) {
    invalidRetrievalPlan("The retrieval-plan review contract or its unchanged gates are invalid.");
  }
  if (contentId("srprev", reviewCore(review)) !== review.reviewId)
    invalidRetrievalPlan("The retrieval-plan review ID does not match its content.");
}

function policyCore(
  policy: SearchRetrievalPlanPolicy,
): Omit<SearchRetrievalPlanPolicy, "policyId"> {
  const { policyId: _policyId, ...core } = policy;
  return core;
}

export function createSearchRetrievalPlanPolicy(
  input: Omit<SearchRetrievalPlanPolicy, "schemaVersion" | "policyId">,
): SearchRetrievalPlanPolicy {
  const core = { schemaVersion: 1 as const, ...structuredClone(input) };
  const policy = { ...core, policyId: contentId("srppol", core) };
  assertSearchRetrievalPlanPolicy(policy);
  return policy;
}

export function assertSearchRetrievalPlanPolicy(policy: SearchRetrievalPlanPolicy): void {
  assertRetrievalPlanTimestamp(policy.createdAt);
  assertUniqueRetrievalPlanIds(policy.allowedPlanIds, PLAN_ID_PATTERN, "plan");
  assertUniqueRetrievalPlanIds(policy.reviewerIds, ACTOR_ID_PATTERN, "reviewer");
  assertUniqueRetrievalPlanIds(policy.operatorIds, ACTOR_ID_PATTERN, "operator");
  if (
    policy.schemaVersion !== 1 ||
    !POLICY_ID_PATTERN.test(policy.policyId) ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(policy.projectId) ||
    !ACTOR_ID_PATTERN.test(policy.authorId) ||
    !policy.operatorIds.includes(policy.authorId) ||
    !Number.isSafeInteger(policy.minimumPopulations) ||
    policy.minimumPopulations < 2 ||
    policy.minimumPopulations > 8 ||
    policy.requirePerfectObservationPass !== true ||
    policy.requireCompleteUsage !== true ||
    policy.requireZeroProjectionFailures !== true ||
    policy.requireDurationWithinLimit !== true
  ) {
    invalidRetrievalPlan("The retrieval-plan activation policy is invalid.");
  }
  if (contentId("srppol", policyCore(policy)) !== policy.policyId)
    invalidRetrievalPlan("The retrieval-plan policy ID does not match its content.");
}

function bundleCore(
  bundle: SearchRetrievalPlanActivationBundle,
): Omit<SearchRetrievalPlanActivationBundle, "bundleId"> {
  const { bundleId: _bundleId, ...core } = bundle;
  return core;
}

export function createSearchRetrievalPlanActivationBundle(input: {
  plan: SearchRetrievalPlanActivationBundle["plan"];
  review: SearchRetrievalPlanReview;
  policy: SearchRetrievalPlanPolicy;
}): SearchRetrievalPlanActivationBundle {
  const core = { schemaVersion: 1 as const, ...structuredClone(input) };
  const bundle = { ...core, bundleId: contentId("srpbundle", core) };
  assertSearchRetrievalPlanActivationBundle(bundle);
  return bundle;
}

export function assertSearchRetrievalPlanActivationBundle(
  bundle: SearchRetrievalPlanActivationBundle,
): void {
  assertSearchRetrievalPlan(bundle.plan);
  assertSearchRetrievalPlanReview(bundle.review);
  assertSearchRetrievalPlanPolicy(bundle.policy);
  const populations = new Set(bundle.plan.projection.populations.map((item) => item.populationId));
  if (
    bundle.schemaVersion !== 1 ||
    !BUNDLE_ID_PATTERN.test(bundle.bundleId) ||
    bundle.review.planId !== bundle.plan.planId ||
    !bundle.policy.allowedPlanIds.includes(bundle.plan.planId) ||
    !bundle.policy.reviewerIds.includes(bundle.review.reviewerId) ||
    bundle.review.populations.length < bundle.policy.minimumPopulations ||
    bundle.review.populations.some((item) => !populations.has(item.populationId))
  ) {
    invalidRetrievalPlan("The retrieval-plan activation bundle is not eligible.");
  }
  if (contentId("srpbundle", bundleCore(bundle)) !== bundle.bundleId)
    invalidRetrievalPlan("The retrieval-plan activation bundle ID does not match its content.");
}
