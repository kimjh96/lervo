import { contentId } from "./integrity.js";
import {
  ACTIVATION_ID_PATTERN,
  ACTOR_ID_PATTERN,
  assertRetrievalPlanTimestamp,
  BUNDLE_ID_PATTERN,
  invalidRetrievalPlan,
  PLAN_ID_PATTERN,
  POLICY_ID_PATTERN,
  REVIEW_ID_PATTERN,
} from "./retrieval-plan-common.js";
import { assertSearchRetrievalPlanActivationBundle } from "./retrieval-plan-review.js";
import type {
  SearchRetrievalPlanActivation,
  SearchRetrievalPlanActivationBundle,
  SearchRetrievalPlanSelection,
} from "./retrieval-plan-types.js";

export function baselineSearchRetrievalPlanSelection(): SearchRetrievalPlanSelection {
  return { mode: "baseline", planId: null, reviewId: null, bundleId: null };
}

function activationCore(
  activation: SearchRetrievalPlanActivation,
): Omit<SearchRetrievalPlanActivation, "activationId"> {
  const { activationId: _activationId, ...core } = activation;
  return core;
}

function candidateSelection(
  bundle: SearchRetrievalPlanActivationBundle,
): SearchRetrievalPlanSelection {
  return {
    mode: "candidate",
    planId: bundle.plan.planId,
    reviewId: bundle.review.reviewId,
    bundleId: bundle.bundleId,
  };
}

export function createSearchRetrievalPlanActivation(input: {
  bundle: SearchRetrievalPlanActivationBundle;
  operatorId: string;
  decidedAt: Date;
  previous: SearchRetrievalPlanActivation | null;
}): SearchRetrievalPlanActivation {
  assertSearchRetrievalPlanActivationBundle(input.bundle);
  if (!input.bundle.policy.operatorIds.includes(input.operatorId))
    invalidRetrievalPlan("The retrieval-plan operator is not authorized by policy.");
  const previousSelection = input.previous?.selected ?? baselineSearchRetrievalPlanSelection();
  if (previousSelection.mode === "candidate")
    invalidRetrievalPlan("A retrieval plan is already active; roll it back first.");
  const core = {
    schemaVersion: 1 as const,
    projectId: input.bundle.policy.projectId,
    sequence: (input.previous?.sequence ?? 0) + 1,
    previousActivationId: input.previous?.activationId ?? null,
    action: "activate_plan" as const,
    policyId: input.bundle.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    selected: candidateSelection(input.bundle),
    rollbackTarget: structuredClone(previousSelection),
  };
  const activation = { ...core, activationId: contentId("srpact", core) };
  assertSearchRetrievalPlanActivation(activation, input.previous);
  return activation;
}

export function createSearchRetrievalPlanRollback(input: {
  bundle: SearchRetrievalPlanActivationBundle;
  operatorId: string;
  decidedAt: Date;
  previous: SearchRetrievalPlanActivation;
}): SearchRetrievalPlanActivation {
  assertSearchRetrievalPlanActivationBundle(input.bundle);
  if (
    input.previous.selected.mode !== "candidate" ||
    input.previous.selected.bundleId !== input.bundle.bundleId ||
    !input.bundle.policy.operatorIds.includes(input.operatorId)
  ) {
    invalidRetrievalPlan("The retrieval-plan rollback coordinates are not authorized.");
  }
  const core = {
    schemaVersion: 1 as const,
    projectId: input.bundle.policy.projectId,
    sequence: input.previous.sequence + 1,
    previousActivationId: input.previous.activationId,
    action: "rollback" as const,
    policyId: input.bundle.policy.policyId,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt.toISOString(),
    selected: structuredClone(input.previous.rollbackTarget),
    rollbackTarget: structuredClone(input.previous.selected),
  };
  const activation = { ...core, activationId: contentId("srpact", core) };
  assertSearchRetrievalPlanActivation(activation, input.previous);
  return activation;
}

export function assertSearchRetrievalPlanActivation(
  activation: SearchRetrievalPlanActivation,
  previous?: SearchRetrievalPlanActivation | null,
): void {
  assertRetrievalPlanTimestamp(activation.decidedAt);
  const selectionValid = (selection: SearchRetrievalPlanSelection) =>
    selection.mode === "baseline"
      ? selection.planId === null && selection.reviewId === null && selection.bundleId === null
      : PLAN_ID_PATTERN.test(selection.planId) &&
        REVIEW_ID_PATTERN.test(selection.reviewId) &&
        BUNDLE_ID_PATTERN.test(selection.bundleId);
  if (
    activation.schemaVersion !== 1 ||
    !ACTIVATION_ID_PATTERN.test(activation.activationId) ||
    !/^prj_[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/.test(activation.projectId) ||
    !Number.isSafeInteger(activation.sequence) ||
    activation.sequence < 1 ||
    (activation.previousActivationId !== null &&
      !ACTIVATION_ID_PATTERN.test(activation.previousActivationId)) ||
    !POLICY_ID_PATTERN.test(activation.policyId) ||
    !ACTOR_ID_PATTERN.test(activation.operatorId) ||
    !selectionValid(activation.selected) ||
    !selectionValid(activation.rollbackTarget) ||
    (activation.action === "activate_plan" && activation.selected.mode !== "candidate") ||
    (activation.action === "rollback" && activation.selected.mode !== "baseline")
  ) {
    invalidRetrievalPlan("The retrieval-plan activation contract is invalid.");
  }
  if (
    previous !== undefined &&
    (activation.sequence !== (previous?.sequence ?? 0) + 1 ||
      activation.previousActivationId !== (previous?.activationId ?? null) ||
      (previous !== null && activation.projectId !== previous.projectId))
  ) {
    invalidRetrievalPlan("The retrieval-plan activation chain is invalid.");
  }
  if (contentId("srpact", activationCore(activation)) !== activation.activationId)
    invalidRetrievalPlan("The retrieval-plan activation ID does not match its content.");
}
