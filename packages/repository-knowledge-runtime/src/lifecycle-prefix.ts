import {
  lifecycleChangedPaths,
  missingLifecyclePaths,
  userContentOutsideRoots,
} from "./lifecycle-plan-scope.js";
import { knowledgeEffectPreflight } from "./knowledge-effect-guard.js";
import { observeDocumentDeferrals } from "./document-deferral-health.js";
import {
  applyLifecycleEffect,
  parkUserOwnedLifecyclePlan,
  waitForLifecycleEffect,
} from "./lifecycle-effect-hold.js";
import { inspectDocumentRouteResolutionContext } from "./document-route-resolution-context.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";
import { convergenceOperationEffects } from "./effect-source-fence.js";
import {
  canonicalJson,
  sha256,
  createKnowledgeInstructionBootstrapPlan,
  applyKnowledgeInstructionBootstrapPlan,
  createRepositoryLayoutMigrationPlan,
  applyRepositoryLayoutMigrationPlan,
  repositoryLayoutItemBindings,
  lintRepositoryKnowledge,
  validateKnowledgeStage,
  repositoryLayoutKnowledgeLintCodes,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { classifyDeferredDocumentRoutes } from "./document-route-classification.js";
import {
  carriedParkedSources,
  mergeParkedSources,
  obligationParkedSources,
} from "./convergence-parking.js";
import {
  lifecyclePlanParked,
  lifecyclePlanRejection,
  parkLifecyclePlan,
  type LifecyclePlanKind,
} from "./lifecycle-plan-parking.js";
import { reviewLifecyclePlan } from "./lifecycle-plan-review.js";
import { withConvergenceAssignment } from "./workforce.js";
import { assertConvergenceDelegation, pathWithinConvergenceRoots } from "./delegation.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { verifyConvergenceEffect } from "./stage-verification.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/** Bootstrap and layout precede any semantic or normalization stage. One exact plan per continuation. */
export async function prepareConvergenceLifecycle(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult | null> {
  const root = context.storage.paths.repositoryRoot;
  const bootstrap = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
  const documentRouteContext = await inspectDocumentRouteResolutionContext({
    repositoryRoot: root,
    ...(context.admissionDirectory === undefined
      ? {}
      : { admissionDirectory: context.admissionDirectory }),
  });
  let layout = await createRepositoryLayoutMigrationPlan({
    repositoryRoot: root,
    documentRouteContext,
  });
  // ADR-0476: deferred documents are classified first; the plan then carries their exact moves.
  if (
    bootstrap.status === "not_applicable" &&
    (await classifyDeferredDocumentRoutes(context, state, assertLease, layout)) > 0
  )
    layout = await createRepositoryLayoutMigrationPlan({
      repositoryRoot: root,
      documentRouteContext,
    });
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  const governedRoots = [...delegation.canonicalRoots, ...delegation.normalizationRoots];
  await observeDocumentDeferrals({ repositoryRoot: root, layout });
  const plan =
    bootstrap.status !== "not_applicable" ? bootstrap : layout.status !== "current" ? layout : null;
  if (plan === null) return null;
  if (plan.status === "blocked")
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      kind: "attention_required",
      reason: "knowledge_lifecycle_blocked",
      dependency: { kind: "lifecycle_plan", snapshotHash: state.snapshotHash, planId: plan.planId },
    });
  const paths = lifecycleChangedPaths(plan);
  // ADR-0561: a reviewed plan may move whole documents and write Lervo's own outputs outside the
  // delegation's roots, because its exact path set is reviewed. A plan that applies without review
  // stays inside them, and so do user-owned bytes (AGENTS.md invariant 5).
  const reviewed = plan.status === "review_required";
  if (!reviewed && missingLifecyclePaths(plan, governedRoots).length > 0)
    throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
  const kind: LifecyclePlanKind =
    plan.planKind === "repository_layout" ? "repository_layout" : "instruction_bootstrap";
  const parked = mergeParkedSources(
    await carriedParkedSources(context.storage, state),
    obligationParkedSources(state),
  );
  const planHash = sha256(canonicalJson(plan));
  // ADR-0485: a parked exact plan never holds assessment; canonical work continues past it.
  if (lifecyclePlanParked(parked, kind, planHash)) return null;
  const userOwned = reviewed ? userContentOutsideRoots(plan, governedRoots) : [];
  if (userOwned.length > 0)
    return parkUserOwnedLifecyclePlan({
      context,
      state,
      stage: "assessment",
      kind,
      planId: plan.planId,
      planHash,
      userOwned,
    });
  let approval: Awaited<ReturnType<typeof reviewLifecyclePlan>> | null = null;
  try {
    approval = reviewed
      ? await reviewLifecyclePlan(context, state, assertLease, plan, paths)
      : null;
  } catch (error) {
    const rejection = lifecyclePlanRejection(error);
    if (rejection === null) throw error;
    return completeConvergenceStage({
      sources: convergenceSourceObservation(context),
      artifacts: context.storage.artifacts,
      state,
      stage: "assessment",
      nextStage: "assessment",
      stageData: {
        parkedSources: parkLifecyclePlan(obligationParkedSources(state), kind, rejection),
      },
      proof: { status: "lifecycle_plan_parked", planKind: kind, planHash: rejection.planHash },
    });
  }
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "assessment",
    role: "writer",
    state,
    paths,
    writeScope: reviewed ? "reviewed_plan" : "delegation_roots",
    assertLease,
    run: async (authority) => {
      const governed = [
        ...authority.delegation.canonicalRoots,
        ...authority.delegation.normalizationRoots,
      ];
      if (
        (reviewed && approval === null) ||
        (reviewed && userContentOutsideRoots(plan, governed).length > 0) ||
        (!reviewed &&
          paths.some(
            (path) =>
              !convergenceManagedKnowledgePath(path) && !pathWithinConvergenceRoots(path, governed),
          )) ||
        approval?.reviewerAgentId === authority.agent.agentId
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      // ADR-0561: a reviewed effect applies only when it can land as its own commit and touches
      // no uncommitted user edit; otherwise it waits as Lervo debt until the owner commits.
      const hold = reviewed ? await knowledgeEffectPreflight(root, paths) : null;
      if (hold !== null)
        return waitForLifecycleEffect({ context, state, planId: plan.planId, hold });
      const before = await lintRepositoryKnowledge(root);
      const record = async (receipt: unknown) => {
        await authority.assertCurrent();
        const validation = validateKnowledgeStage({
          stage: "background lifecycle prefix",
          before,
          after: await lintRepositoryKnowledge(root, { allowTransactionPlanId: plan.planId }),
          ownedErrorCodes: repositoryLayoutKnowledgeLintCodes,
          expectedTransitionCodes: new Set(["instruction_bridge_binding_stale"]),
        });
        const verification = await verifyConvergenceEffect(
          context,
          authority,
          state.baseline.policyHash,
        );
        await recordConvergenceMaterialization(context.storage, {
          operation:
            plan.planKind === "repository_layout"
              ? "repository_layout"
              : "instruction_canonical_adoption",
          planId: plan.planId,
          sourceSnapshotId: plan.sourceSnapshotId,
          policyHash: state.baseline.policyHash,
          receipt: { receipt, approval, verification },
          created: [],
          updated: paths,
          deleted: [],
          validation,
        });
      };
      await authority.assertCurrent();
      context.assertSourceExact(state);
      const apply = async () =>
        plan.planKind === "repository_layout"
          ? await applyRepositoryLayoutMigrationPlan({
              plan,
              itemBindings: repositoryLayoutItemBindings(plan),
              now: new Date(),
              recordApplied: record,
            })
          : await applyKnowledgeInstructionBootstrapPlan({
              plan,
              approvedOperationId: plan.operationId!,
              approvedHash: plan.approvalHash!,
              now: new Date(),
              recordApplied: record,
            });
      const { receipt, commit } = await applyLifecycleEffect({
        repositoryRoot: root,
        paths,
        reviewed: approval === null ? null : { plan, approval },
        apply,
        assertCurrent: () => authority.assertCurrent(),
      });
      context.sourceObservation?.noteChange();
      return completeConvergenceStage({
        sources: convergenceSourceObservation(context),
        artifacts: context.storage.artifacts,
        state,
        stage: "assessment",
        nextStage: "assessment",
        stageData: {
          canonicalOffset: 0,
          assessmentSources: convergenceSourceObservation(context).current(
            state.baseline.policyHash,
          ).sources,
        },
        approvedEffects: convergenceOperationEffects(plan.operations),
        ...(commit === null
          ? {}
          : { committedHead: { before: commit.before, after: commit.after } }),
        proof: {
          status: "lifecycle_prefix_applied",
          receipt,
          approval,
          commit: commit === null ? null : commit.after,
        },
      });
    },
  });
}
