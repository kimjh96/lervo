import { convergenceAssessmentSources } from "./assessment-scope.js";
import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import type { CanonicalBatch } from "./canonical-review.js";
import { sealCanonicalDrafts } from "./canonical-workspace.js";
import { integrateCanonicalWorkspace } from "./canonical-integration-effect.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { preflightCanonicalTargets } from "./canonical-target-preflight.js";
import { inspectRetainedCanonicalIntegration } from "./canonical-integration-recovery.js";
import { parkDivergedCanonicalBatch } from "./canonical-target-parking.js";

export async function integrateCanonicalBaseline(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const batch = state.stageData.canonicalBatch as CanonicalBatch | null;
  const expectedSources = convergenceAssessmentSources(state);
  const end = batch === null ? expectedSources.length : batch.offset + batch.count;
  const finish = (proof: unknown, additional: Record<string, unknown> = {}) =>
    completeConvergenceStage({
      repositoryRoot: root,
      artifacts: context.storage.artifacts,
      state,
      stage: "canonical_integration",
      nextStage: end < expectedSources.length ? "assessment" : "normalization_generation",
      stageData: {
        canonicalOffset: end,
        canonicalBatch: null,
        canonicalCoverage: [
          ...((state.stageData.canonicalCoverage as unknown[] | undefined) ?? []),
          ...(batch?.assessment.decisions ?? []).map((decision) => ({
            path: decision.path,
            contentHash: decision.contentHash,
            disposition: decision.disposition,
            assessmentHash: sha256(canonicalJson(batch!.assessment)),
          })),
        ],
        ...additional,
      },
      approvedEffects: (batch?.assessment.drafts ?? []).map((draft) => ({
        path: draft.path,
        beforeHash: draft.beforeHash,
        afterHash: sha256(draft.content),
      })),
      proof,
    });
  if (batch === null) return finish({ status: "empty_scope" });
  const approval = state.stageData.canonicalApproval as {
    assessmentHash?: string;
    reviewerAgentId?: string;
    delegationHash?: string;
    policyHash?: string;
  } | null;
  if (
    !approval ||
    approval.assessmentHash !== sha256(canonicalJson(batch.assessment)) ||
    approval.delegationHash !== state.baseline.delegationHash ||
    approval.policyHash !== state.baseline.policyHash
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
  if (!batch.assessment.drafts.length)
    return finish({
      status: "semantically_covered",
      approval,
      sourceBindings: batch.sources.map(({ path, contentHash }) => ({ path, contentHash })),
    });
  const paths = batch.assessment.drafts.map((draft) => draft.path);
  if (batch.assessment.drafts.some((draft) => draft.beforeHash === sha256(draft.content)))
    throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
  const retained = await inspectRetainedCanonicalIntegration(
    context,
    state,
    batch.assessment.drafts,
  );
  const diverged = retained
    ? []
    : await preflightCanonicalTargets(context, state, batch.assessment.drafts);
  if (diverged.length > 0) return parkDivergedCanonicalBatch(context, state, batch, diverged);
  const sealed = await withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "canonical_integration",
    role: "writer",
    state,
    paths,
    assertLease,
    run: async (authority) => {
      if (
        paths.some(
          (path) => !pathWithinConvergenceRoots(path, authority.delegation.canonicalRoots),
        ) ||
        authority.agent.agentId === approval.reviewerAgentId
      )
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      const receipt = await sealCanonicalDrafts(context, state, authority, batch.assessment.drafts);
      return {
        state: "current",
        input: { ...state, stageData: { ...state.stageData, canonicalSealed: receipt } },
        assignmentId: null,
        leaseGeneration: null,
        failureCode: null,
        dependencyHash: null,
        nextStage: "canonical_integration",
      };
    },
  });
  const receipt = sealed.input.stageData.canonicalSealed as { workspaceId: string };
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "canonical_integration",
    role: "integrator",
    state: sealed.input,
    paths,
    assertLease,
    run: async (authority) => {
      if (authority.agent.agentId === approval.reviewerAgentId)
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      const integration = await integrateCanonicalWorkspace(
        context,
        state,
        authority,
        receipt.workspaceId,
        batch.assessment.drafts,
      );
      return finish({ integration, approval });
    },
  });
}
