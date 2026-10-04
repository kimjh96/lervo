import { convergenceOperationEffects } from "./effect-source-fence.js";
import {
  loadDocumentNormalizationCandidate,
  createDocumentNormalizationPlan,
  applyDocumentNormalizationPlan,
  inspectConfiguredDocumentNormalization,
  lintRepositoryKnowledge,
  normalizationKnowledgeLintCodes,
  validateKnowledgeStage,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import { verifyConvergenceEffect } from "./stage-verification.js";
import { recordConvergenceMaterialization } from "./materialization-event.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { NormalizationBatch } from "./normalization-generation.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

export async function applyNormalizationBatch(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const batch = state.stageData.normalizationBatch as NormalizationBatch | null;
  const id = state.stageData.normalizationAcceptedCandidateId;
  if (batch === null || id === null)
    return completeConvergenceStage({
      repositoryRoot: root,
      artifacts: context.storage.artifacts,
      state,
      stage: "normalization_apply",
      nextStage: batch === null ? "lifecycle_verification" : "normalization_generation",
      stageData: { normalizationCursor: batch?.paths.at(-1) ?? "" },
      proof: { status: "no_approved_effect" },
    });
  if (typeof id !== "string" || !batch)
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const candidate = await loadDocumentNormalizationCandidate({
    repositoryRoot: root,
    candidateId: id,
  });
  const reviewedPlan = await createDocumentNormalizationPlan({
    repositoryRoot: root,
    candidate,
    now: new Date(),
  });
  const writePaths = [
    ...new Set(
      reviewedPlan.operations
        .filter((operation) => operation.action !== "unchanged")
        .map((operation) => operation.path),
    ),
  ];
  const paths = [
    ...new Set(
      candidate.items.flatMap((item) => [
        item.sourcePath,
        ...item.outputs.map((output) => output.path),
      ]),
    ),
  ];
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "normalization_apply",
    role: "writer",
    state,
    paths: writePaths,
    assertLease,
    run: async (authority) => {
      if (
        paths.some(
          (path) => !pathWithinConvergenceRoots(path, authority.delegation.normalizationRoots),
        )
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      const review = state.stageData.normalizationReview as
        | {
            reviewerAgentId?: string;
            decisions?: { operationId: string; decision: string; sourceContentHash: string }[];
          }
        | undefined;
      if (
        !review ||
        review.reviewerAgentId === authority.agent.agentId ||
        candidate.items.some(
          (item) =>
            !review.decisions?.some(
              (decision) =>
                decision.operationId === item.operationId &&
                decision.decision === "approve" &&
                decision.sourceContentHash === item.sourceContentHash,
            ),
        )
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
      await authority.assertCurrent();
      context.assertSource(state);
      const plan = await createDocumentNormalizationPlan({
        repositoryRoot: root,
        candidate,
        now: new Date(),
      });
      const beforeLint = await lintRepositoryKnowledge(root);
      let verification: string[] = [];
      const receipt = await applyDocumentNormalizationPlan({
        plan,
        candidate,
        now: new Date(),
        approvals: candidate.items.map(({ operationId, approvalHash }) => ({
          operationId,
          approvalHash,
        })),
        recordApplied: async (effect) => {
          await authority.assertCurrent();
          const validation = validateKnowledgeStage({
            stage: "background normalization",
            before: beforeLint,
            after: await lintRepositoryKnowledge(root, { allowTransactionPlanId: plan.planId }),
            ownedErrorCodes: normalizationKnowledgeLintCodes,
            expectedTransitionCodes: new Set(
              paths.includes("AGENTS.md") || paths.includes("CLAUDE.md")
                ? ["instruction_bridge_binding_stale"]
                : [],
            ),
          });
          verification = await verifyConvergenceEffect(
            context,
            authority,
            state.baseline.policyHash,
          );
          await recordConvergenceMaterialization(context.storage, {
            operation: "normalize_documents",
            planId: plan.planId,
            sourceSnapshotId: plan.sourceSnapshotId,
            policyHash: state.baseline.policyHash,
            receipt: effect,
            created: effect.created,
            updated: effect.updated,
            deleted: effect.deleted,
            validation,
          });
        },
      });
      const pending = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
      return completeConvergenceStage({
        repositoryRoot: root,
        artifacts: context.storage.artifacts,
        state,
        stage: "normalization_apply",
        nextStage: pending.pendingDocuments.length
          ? "normalization_generation"
          : "lifecycle_verification",
        stageData: {
          normalizationCursor: batch.paths.at(-1) ?? "",
          normalizationBatch: null,
          normalizationAcceptedCandidateId: null,
          normalizationReview: null,
          canonicalBatch: null,
        },
        approvedEffects: convergenceOperationEffects(plan.operations),
        proof: { receipt, verification, review },
      });
    },
  });
}
