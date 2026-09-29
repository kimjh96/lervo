import { resolveConvergenceCandidates } from "./candidate-resolution.js";
import { convergenceManagedKnowledgePath } from "./managed-knowledge-scope.js";
import { convergenceOperationEffects } from "./effect-source-fence.js";
import { unresolvedConvergenceAssets } from "./asset-verification.js";
import { convergenceAssessmentSources } from "./assessment-scope.js";
import {
  canonicalJson,
  sha256,
  createKnowledgeMigrationPlan,
  applyKnowledgeMigrationPlan,
  createKnowledgeInstructionBridgePlan,
  applyKnowledgeInstructionBridgePlan,
  inspectRepositoryKnowledgeCurrency,
  lintRepositoryKnowledge,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { reviewLifecyclePlan } from "./lifecycle-plan-review.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { verifyConvergenceEffect } from "./stage-verification.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { captureConvergenceSources } from "./source-capture.js";
import { resolveConvergenceAssetDispositions } from "./asset-disposition-manifest.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

export async function verifyConvergenceLifecycle(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const candidates = await resolveConvergenceCandidates(context, state, assertLease);
  if (candidates !== null) return candidates;
  const bridge = await createKnowledgeInstructionBridgePlan({
    repositoryRoot: root,
    provider: "claude",
  });
  const migration = await createKnowledgeMigrationPlan({ repositoryRoot: root, mode: "migrate" });
  const plan =
    bridge.status !== "current"
      ? bridge
      : migration.operations.some((operation) => operation.action !== "unchanged")
        ? migration
        : null;
  if (plan) {
    const bridgePlan = "profile" in plan;
    const paths = plan.operations
      .filter((operation) => operation.action !== "unchanged")
      .map((operation) => operation.path);
    const approval =
      bridgePlan && plan.status === "review_required"
        ? await reviewLifecyclePlan(context, state, assertLease, plan, paths)
        : null;
    return withConvergenceAssignment({
      storage: context.storage,
      provider: context.provider,
      stage: "lifecycle_verification",
      role: "writer",
      state,
      paths,
      assertLease,
      run: async (authority) => {
        if (
          paths.some(
            (path) =>
              !convergenceManagedKnowledgePath(path) &&
              !pathWithinConvergenceRoots(path, [
                ...authority.delegation.canonicalRoots,
                ...authority.delegation.normalizationRoots,
              ]),
          ) ||
          approval?.reviewerAgentId === authority.agent.agentId
        )
          throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
        await authority.assertCurrent();
        context.assertSource(state);
        const record = async (receipt: unknown) => {
          await authority.assertCurrent();
          const validation = await lintRepositoryKnowledge(
            root,
            bridgePlan ? { allowTransactionPlanId: plan.planId } : {},
          );
          if (!validation.valid)
            throw new KnowledgeConvergenceRuntimeError("knowledge_lint_invalid");
          const verification = await verifyConvergenceEffect(
            context,
            authority,
            state.baseline.policyHash,
          );
          await recordConvergenceMaterialization(context.storage, {
            operation: bridgePlan ? "instruction_bridge_update" : "migrate",
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
        const receipt = bridgePlan
          ? await applyKnowledgeInstructionBridgePlan({
              plan,
              now: new Date(),
              recordApplied: record,
              ...(plan.status === "review_required"
                ? { approvedOperationId: plan.operationId, approvedHash: plan.approvalHash }
                : {}),
            })
          : await applyKnowledgeMigrationPlan(plan, new Date(), record);
        return completeConvergenceStage({
          repositoryRoot: root,
          artifacts: context.storage.artifacts,
          state,
          stage: "lifecycle_verification",
          nextStage: "lifecycle_verification",
          stageData: {},
          approvedEffects: convergenceOperationEffects(plan.operations),
          proof: { status: "ordered_lifecycle_applied", receipt, approval },
        });
      },
    });
  }
  const assets = await unresolvedConvergenceAssets(context, state);
  if (assets !== null) return assets;
  const rejection = state.stageData.canonicalRejection as { artifactHash: string } | undefined;
  if (rejection !== undefined)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      kind: "attention_required",
      reason: "knowledge_semantic_review_rejected",
      dependency: {
        kind: "canonical_rejection",
        snapshotHash: state.snapshotHash,
        rejectionArtifactHash: rejection.artifactHash,
        retainedForNormalization: true,
      },
    });
  const before = captureConvergenceSources(root, state.baseline.policyHash);
  const currency = await inspectRepositoryKnowledgeCurrency(root);
  const lint = await lintRepositoryKnowledge(root);
  const after = captureConvergenceSources(root, state.baseline.policyHash);
  const expectedSources = convergenceAssessmentSources(state);
  const offset = Number(state.stageData.canonicalOffset ?? 0);
  if (before.snapshotHash !== after.snapshotHash)
    throw new KnowledgeConvergenceRuntimeError("source_bytes_changed");
  const coverage =
    (state.stageData.canonicalCoverage as
      { path: string; contentHash: string; disposition: string }[] | undefined) ?? [];
  const completeCoverage =
    coverage.length === expectedSources.length &&
    new Set(coverage.map((item) => item.path)).size === expectedSources.length &&
    expectedSources.every((source) =>
      coverage.some(
        (item) =>
          item.path === source.path &&
          item.contentHash === source.contentHash &&
          ["no_change", "covered", "candidate"].includes(item.disposition),
      ),
    );
  if (!currency.current || !lint.valid || offset !== expectedSources.length || !completeCoverage)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      kind: "attention_required",
      reason: "knowledge_lifecycle_incomplete",
      dependency: {
        kind: "lifecycle_currency",
        snapshotHash: state.snapshotHash,
        currency,
        lintHash: sha256(canonicalJson(lint)),
        coveredSources: offset,
        expectedSources: expectedSources.length,
      },
    });
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "lifecycle_verification",
    role: "reviewer",
    state,
    paths: [...new Set(state.baseline.sources.map((source) => source.path.split("/")[0]!))],
    assertLease,
    run: async (authority) => {
      const verification = await verifyConvergenceEffect(
        context,
        authority,
        state.baseline.policyHash,
      );
      context.assertSource(state);
      return completeConvergenceStage({
        repositoryRoot: root,
        artifacts: context.storage.artifacts,
        state,
        stage: "lifecycle_verification",
        nextStage: null,
        stageData: {},
        knowledgeSnapshotHash: currency.snapshotHash,
        proof: {
          currency,
          lint,
          verification,
          scopeHash: sha256(canonicalJson(state.baseline.sources)),
          coveredSources: offset,
          canonicalCoverageHash: sha256(canonicalJson(coverage)),
          assetDispositionHash: sha256(
            canonicalJson(resolveConvergenceAssetDispositions(root, authority.delegation)),
          ),
        },
      });
    },
  });
}
