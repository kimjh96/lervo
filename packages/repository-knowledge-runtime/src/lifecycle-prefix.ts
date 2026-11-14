import {
  deferLayoutOutsideScope,
  lifecycleChangedPaths,
  missingLifecyclePaths,
} from "./lifecycle-plan-scope.js";
import { observeDocumentDeferrals } from "./document-deferral-health.js";
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
  const missingPaths = missingLifecyclePaths(layout, governedRoots);
  if (missingPaths.length > 0 && layout.moves.length > 0)
    layout = deferLayoutOutsideScope(layout, missingPaths);
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
  if (missingLifecyclePaths(plan, governedRoots).length > 0)
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
  let approval: Awaited<ReturnType<typeof reviewLifecyclePlan>> | null = null;
  try {
    approval =
      plan.status === "review_required"
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
    assertLease,
    run: async (authority) => {
      const governed = [
        ...authority.delegation.canonicalRoots,
        ...authority.delegation.normalizationRoots,
      ];
      if (
        paths.some(
          (path) =>
            !convergenceManagedKnowledgePath(path) && !pathWithinConvergenceRoots(path, governed),
        ) ||
        approval?.reviewerAgentId === authority.agent.agentId
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
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
      const receipt =
        plan.planKind === "repository_layout"
          ? await applyRepositoryLayoutMigrationPlan({
              plan,
              approvals: [...plan.moves, ...plan.userUpdates].map(
                ({ operationId, approvalHash }) => ({ operationId, approvalHash }),
              ),
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
        proof: { status: "lifecycle_prefix_applied", receipt, approval },
      });
    },
  });
}
