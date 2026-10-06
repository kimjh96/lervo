import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";
import { convergenceOperationEffects } from "./effect-source-fence.js";
import {
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
import { reviewLifecyclePlan } from "./lifecycle-plan-review.js";
import { withConvergenceAssignment } from "./workforce.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { verifyConvergenceEffect } from "./stage-verification.js";
import { captureConvergenceSources } from "./source-capture.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

/** Bootstrap and layout precede any semantic or normalization stage. One exact plan per continuation. */
export async function prepareConvergenceLifecycle(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult | null> {
  const root = context.storage.paths.repositoryRoot;
  const bootstrap = await createKnowledgeInstructionBootstrapPlan({ repositoryRoot: root });
  let layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
  // ADR-0476: deferred documents are classified first; the plan then carries their exact moves.
  if (
    bootstrap.status === "not_applicable" &&
    (await classifyDeferredDocumentRoutes(context, state, assertLease, layout)) > 0
  )
    layout = await createRepositoryLayoutMigrationPlan({ repositoryRoot: root });
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
  const paths = [
    ...new Set(
      plan.operations
        .filter((operation) => operation.action !== "unchanged")
        .flatMap((operation) =>
          "destinationPath" in operation
            ? [operation.path, operation.destinationPath]
            : [operation.path],
        ),
    ),
  ];
  const approval =
    plan.status === "review_required"
      ? await reviewLifecyclePlan(context, state, assertLease, plan, paths)
      : null;
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
      context.assertSource(state);
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
      return completeConvergenceStage({
        repositoryRoot: root,
        artifacts: context.storage.artifacts,
        state,
        stage: "assessment",
        nextStage: "assessment",
        stageData: {
          canonicalOffset: 0,
          assessmentSources: captureConvergenceSources(root, state.baseline.policyHash).sources,
        },
        approvedEffects: convergenceOperationEffects(plan.operations),
        proof: { status: "lifecycle_prefix_applied", receipt, approval },
      });
    },
  });
}
