import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";

import { obligationParkedSources } from "./convergence-parking.js";
import { loadConvergenceDelegation } from "./delegation.js";
import { userContentOutsideRoots } from "./lifecycle-plan-scope.js";
import {
  applyCommittedKnowledgeEffect,
  type KnowledgeEffectHold,
} from "./knowledge-effect-guard.js";
import { lifecycleEffectNotice } from "./lifecycle-effect-notice.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { parkLifecyclePlan, type LifecyclePlanKind } from "./lifecycle-plan-parking.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { convergenceSourceObservation } from "./source-observation.js";

/**
 * AGENTS.md invariant 5 under ADR-0561: a reviewed lifecycle plan that would rewrite user-owned
 * bytes outside the delegated roots is parked by its exact hash as Lervo debt. The owner can apply
 * it with `lervo migrate knowledge --apply <plan-id>`; a changed plan is considered again.
 */
export function parkUserOwnedLifecyclePlan(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  stage: "assessment" | "lifecycle_verification";
  kind: LifecyclePlanKind;
  planId: string;
  planHash: string;
  userOwned: readonly string[];
}): Promise<KnowledgeConvergenceStageResult> {
  return completeConvergenceStage({
    sources: convergenceSourceObservation(input.context),
    artifacts: input.context.storage.artifacts,
    state: input.state,
    stage: input.stage,
    nextStage: input.stage,
    stageData: {
      parkedSources: parkLifecyclePlan(
        obligationParkedSources(input.state),
        input.kind,
        {
          planHash: input.planHash,
          rationale: `The plan rewrites user-owned bytes outside the delegated roots (${input.userOwned.slice(0, 4).join(", ")}); Lervo never applies that on its own, and lervo migrate knowledge --apply ${input.planId} applies it for the owner.`,
        },
        "user_owned_content",
      ),
    },
    proof: { status: "lifecycle_plan_parked", planKind: input.kind, planHash: input.planHash },
  });
}

/**
 * ADR-0561: a reviewed effect that cannot land as its own commit, or that would commit a user's
 * uncommitted edit, waits as Lervo debt until the sources change.
 */
export function waitForLifecycleEffect(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  planId: string;
  hold: KnowledgeEffectHold;
}): Promise<KnowledgeConvergenceStageResult> {
  return waitingConvergenceStage({
    artifacts: input.context.storage.artifacts,
    state: input.state,
    kind: "attention_required",
    reason: "knowledge_lifecycle_blocked",
    dependency: {
      kind: "lifecycle_plan",
      snapshotHash: input.state.snapshotHash,
      planId: input.planId,
      hold: input.hold,
    },
  });
}

/**
 * Parks a reviewed plan that rewrites user-owned bytes outside the roots the owner delegated, or
 * returns null when it stays inside them.
 */
export async function parkedForUserOwnedContent(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  stage: "assessment" | "lifecycle_verification";
  kind: LifecyclePlanKind;
  plan: {
    planId: string;
    operations: ReadonlyArray<{
      path: string;
      action: string;
      destinationPath?: string;
      ownership?: string;
    }>;
  };
}): Promise<KnowledgeConvergenceStageResult | null> {
  const delegated = await loadConvergenceDelegation(
    input.context.storage.paths.repositoryRoot,
  ).catch(() => null);
  const userOwned = userContentOutsideRoots(input.plan, [
    ...(delegated?.delegation.canonicalRoots ?? []),
    ...(delegated?.delegation.normalizationRoots ?? []),
  ]);
  if (userOwned.length === 0) return null;
  return parkUserOwnedLifecyclePlan({
    ...input,
    planId: input.plan.planId,
    planHash: sha256(canonicalJson(input.plan)),
    userOwned,
  });
}

/**
 * ADR-0561: applies a lifecycle plan. An unreviewed plan applies as before; a reviewed one lands
 * as its own commit, the undo point its notice names, and a commit that does not land restores
 * every changed path, so nothing stays applied without its undo.
 */
export async function applyLifecycleEffect<T>(input: {
  repositoryRoot: string;
  paths: readonly string[];
  /** The reviewed plan and its approval; null applies an unreviewed plan without a commit. */
  reviewed: {
    plan: Parameters<typeof lifecycleEffectNotice>[0];
    approval: { reviewerAgentId: string };
  } | null;
  apply: () => Promise<T>;
  assertCurrent: () => Promise<void>;
}): Promise<{ receipt: T; commit: { before: string; after: string } | null }> {
  if (input.reviewed === null) return { receipt: await input.apply(), commit: null };
  const effect = await applyCommittedKnowledgeEffect({
    repositoryRoot: input.repositoryRoot,
    paths: input.paths,
    notice: lifecycleEffectNotice(
      input.reviewed.plan,
      `lifecycle reviewer ${input.reviewed.approval.reviewerAgentId} approved`,
    ),
    apply: async () => {
      const applied = await input.apply();
      await input.assertCurrent();
      return applied;
    },
  }).catch((error: unknown) => {
    throw new KnowledgeConvergenceRuntimeError("knowledge_apply_failed", { cause: error });
  });
  return {
    receipt: effect.receipt,
    commit: effect.commit.status === "committed" ? effect.commit : null,
  };
}
