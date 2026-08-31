import {
  assertProductDefaultSearchRetrievalPlan,
  assertSearchRetrievalPlanActivationBundle,
  baselineSearchRetrievalPlanSelection,
  createSearchRetrievalPlanActivation,
  createSearchRetrievalPlanRollback,
  type SearchRetrievalPlanActivation,
  type SearchRetrievalPlanActivationBundle,
  type SearchRetrievalPlanSelection,
  type ProductDefaultSearchRetrievalPlan,
  type ProductDefaultSearchRetrievalPlanSelection,
} from "@lervo/search";

import {
  loadCurrentSearchRetrievalPlanActivation,
  loadSearchRetrievalPlanActivationHistory,
  recordSearchRetrievalPlanActivation,
} from "./retrieval-plan-activation-store.js";
import { loadSearchRetrievalPlanActivationBundle } from "./retrieval-plan-bundle-files.js";
import { SearchLocalError } from "./types.js";

function hash(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export interface OperationalSearchRetrievalPlanInspection {
  selection: OperationalSearchRetrievalPlanSelection;
  selectionTransitionId: string | null;
  transitions: number;
  resolverState: "ready" | "unavailable";
  failureCode: string | null;
  plan: SearchRetrievalPlanActivationBundle["plan"] | null;
  productQualificationId: string | null;
}

export type OperationalSearchRetrievalPlanSelection =
  SearchRetrievalPlanSelection | ProductDefaultSearchRetrievalPlanSelection;

function productDefaultSelection(
  productDefault: ProductDefaultSearchRetrievalPlan,
): ProductDefaultSearchRetrievalPlanSelection {
  assertProductDefaultSearchRetrievalPlan(productDefault);
  return {
    mode: "product_default",
    qualificationId: productDefault.qualificationId,
    planId: productDefault.plan.planId,
    reviewId: null,
    bundleId: null,
  };
}

async function loadVerifiedSelectedBundle(input: {
  repositoryRoot: string;
  projectId: string;
  activation: SearchRetrievalPlanActivation;
}): Promise<SearchRetrievalPlanActivationBundle | null> {
  if (input.activation.selected.mode === "baseline") return null;
  const bundle = await loadSearchRetrievalPlanActivationBundle(
    input.repositoryRoot,
    input.activation.selected.bundleId,
  );
  assertSearchRetrievalPlanActivationBundle(bundle);
  const evidenceBytes = await readRepositoryFile(
    input.repositoryRoot,
    bundle.review.engineEvidence.evidencePath,
    256 * 1024,
  );
  if (
    bundle.policy.projectId !== input.projectId ||
    bundle.policy.policyId !== input.activation.policyId ||
    bundle.plan.planId !== input.activation.selected.planId ||
    bundle.review.reviewId !== input.activation.selected.reviewId ||
    !bundle.policy.operatorIds.includes(input.activation.operatorId) ||
    hash(evidenceBytes) !== bundle.review.engineEvidence.evidenceHash
  ) {
    throw new SearchLocalError(
      "retrieval_plan_selection_unavailable",
      "The retrieval-plan selection differs from its immutable activation bundle.",
    );
  }
  return bundle;
}

async function verifyHistory(input: {
  repositoryRoot: string;
  projectId: string;
  history: readonly SearchRetrievalPlanActivation[];
}): Promise<SearchRetrievalPlanActivationBundle | null> {
  let currentBundle: SearchRetrievalPlanActivationBundle | null = null;
  for (const activation of input.history) {
    try {
      if (activation.action === "activate_plan") {
        currentBundle = await loadVerifiedSelectedBundle({ ...input, activation });
        continue;
      }
      if (activation.rollbackTarget.mode !== "candidate") {
        throw new Error("rollback target is not a candidate plan");
      }
      const bundle = await loadSearchRetrievalPlanActivationBundle(
        input.repositoryRoot,
        activation.rollbackTarget.bundleId,
      );
      assertSearchRetrievalPlanActivationBundle(bundle);
      if (
        bundle.policy.projectId !== input.projectId ||
        bundle.policy.policyId !== activation.policyId ||
        !bundle.policy.operatorIds.includes(activation.operatorId)
      ) {
        throw new Error("rollback bundle coordinates differ");
      }
      currentBundle = null;
    } catch (error) {
      if (error instanceof SearchLocalError) throw error;
      throw new SearchLocalError(
        "retrieval_plan_selection_unavailable",
        "Could not safely verify the retrieval-plan selection chain.",
        { cause: error instanceof Error ? error : undefined },
      );
    }
  }
  return currentBundle;
}

export async function resolveOperationalSearchRetrievalPlan(input: {
  repositoryRoot: string;
  projectId: string;
  productDefault?: ProductDefaultSearchRetrievalPlan;
}): Promise<{
  selection: OperationalSearchRetrievalPlanSelection;
  selectionTransitionId: string | null;
  transitionCount: number;
  bundle: SearchRetrievalPlanActivationBundle | null;
  plan: SearchRetrievalPlanActivationBundle["plan"] | null;
  corpusBinding: "current" | "reviewed" | null;
  productQualificationId: string | null;
}> {
  const history = await loadSearchRetrievalPlanActivationHistory(input.repositoryRoot);
  const current = history.at(-1) ?? null;
  if (current === null) {
    if (input.productDefault !== undefined) {
      return {
        selection: productDefaultSelection(input.productDefault),
        selectionTransitionId: null,
        transitionCount: 0,
        bundle: null,
        plan: input.productDefault.plan,
        corpusBinding: "current",
        productQualificationId: input.productDefault.qualificationId,
      };
    }
    return {
      selection: baselineSearchRetrievalPlanSelection(),
      selectionTransitionId: null,
      transitionCount: 0,
      bundle: null,
      plan: null,
      corpusBinding: null,
      productQualificationId: null,
    };
  }
  if (
    input.productDefault !== undefined &&
    current.selected.mode === "candidate" &&
    current.selected.planId === input.productDefault.plan.planId
  ) {
    return {
      selection: productDefaultSelection(input.productDefault),
      selectionTransitionId: null,
      transitionCount: history.length,
      bundle: null,
      plan: input.productDefault.plan,
      corpusBinding: "current",
      productQualificationId: input.productDefault.qualificationId,
    };
  }
  const bundle = await verifyHistory({ ...input, history });
  return {
    selection: structuredClone(current.selected),
    selectionTransitionId: current.activationId,
    transitionCount: history.length,
    bundle,
    plan: bundle?.plan ?? null,
    corpusBinding: bundle === null ? null : "reviewed",
    productQualificationId: null,
  };
}

export async function inspectOperationalSearchRetrievalPlan(input: {
  repositoryRoot: string;
  projectId: string;
  productDefault?: ProductDefaultSearchRetrievalPlan;
}): Promise<OperationalSearchRetrievalPlanInspection> {
  const history = await loadSearchRetrievalPlanActivationHistory(input.repositoryRoot);
  const current = history.at(-1) ?? null;
  try {
    const resolved = await resolveOperationalSearchRetrievalPlan(input);
    return {
      selection: resolved.selection,
      selectionTransitionId: resolved.selectionTransitionId,
      transitions: resolved.transitionCount,
      resolverState: "ready",
      failureCode: null,
      plan: resolved.plan,
      productQualificationId: resolved.productQualificationId,
    };
  } catch (error) {
    return {
      selection: structuredClone(
        current?.selected ??
          (input.productDefault === undefined
            ? baselineSearchRetrievalPlanSelection()
            : productDefaultSelection(input.productDefault)),
      ),
      selectionTransitionId: current?.activationId ?? null,
      transitions: history.length,
      resolverState: "unavailable",
      failureCode:
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        typeof error.code === "string"
          ? error.code
          : "retrieval_plan_selection_unavailable",
      plan: null,
      productQualificationId: null,
    };
  }
}

export async function activateLocalSearchRetrievalPlan(input: {
  repositoryRoot: string;
  projectId: string;
  bundleId: string;
  operatorId: string;
  decidedAt: Date;
}): Promise<SearchRetrievalPlanActivation> {
  const [bundle, previous] = await Promise.all([
    loadSearchRetrievalPlanActivationBundle(input.repositoryRoot, input.bundleId),
    loadCurrentSearchRetrievalPlanActivation(input.repositoryRoot),
  ]);
  if (bundle.policy.projectId !== input.projectId) {
    throw new SearchLocalError(
      "retrieval_plan_bundle_invalid",
      "The retrieval-plan bundle has different project coordinates.",
    );
  }
  const activation = createSearchRetrievalPlanActivation({
    bundle,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
    previous,
  });
  await recordSearchRetrievalPlanActivation(input.repositoryRoot, activation);
  return activation;
}

export async function rollbackLocalSearchRetrievalPlan(input: {
  repositoryRoot: string;
  projectId: string;
  operatorId: string;
  decidedAt: Date;
}): Promise<SearchRetrievalPlanActivation> {
  const previous = await loadCurrentSearchRetrievalPlanActivation(input.repositoryRoot);
  if (previous === null || previous.selected.mode !== "candidate") {
    throw new SearchLocalError(
      "retrieval_plan_activation_not_found",
      "There is no active retrieval plan to roll back.",
    );
  }
  const bundle = await loadSearchRetrievalPlanActivationBundle(
    input.repositoryRoot,
    previous.selected.bundleId,
  );
  if (bundle.policy.projectId !== input.projectId) {
    throw new SearchLocalError(
      "retrieval_plan_bundle_invalid",
      "The retrieval-plan rollback bundle has different project coordinates.",
    );
  }
  const activation = createSearchRetrievalPlanRollback({
    bundle,
    operatorId: input.operatorId,
    decidedAt: input.decidedAt,
    previous,
  });
  await recordSearchRetrievalPlanActivation(input.repositoryRoot, activation);
  return activation;
}
import { createHash } from "node:crypto";

import { readRepositoryFile } from "@lervo/context";
