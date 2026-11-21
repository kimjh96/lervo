import { canonicalJson, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import { convergenceManagedKnowledgeRoots } from "./managed-knowledge-scope.js";
import { reviewKnowledgeJson } from "./provider-call.js";
import { withConvergenceAssignment } from "./workforce.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import {
  LIFECYCLE_PLAN_REVIEW_PROMPT,
  LIFECYCLE_PLAN_REVIEW_TASK,
  lifecyclePlanReviewInput,
  lifecyclePlanReviewSchema,
  lifecyclePlanReviewVerdict,
} from "./lifecycle-plan-review-input.js";

/**
 * The independent exact lifecycle plan review (ADR-0479). ADR-0561: the reviewed plan carries its
 * own exact path set, so the review no longer requires the paths to sit inside the delegation's
 * roots; the reviewer must still be another agent than the writer that applies the plan.
 */
export async function reviewLifecyclePlan(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
  plan: unknown,
  paths: string[],
): Promise<{ planHash: string; reviewerAgentId: string; rationale: string }> {
  const review = await lifecyclePlanReviewInput({
    repositoryRoot: context.storage.paths.repositoryRoot,
    plan,
    paths,
  });
  const { planHash } = review;
  const result = await withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "lifecycle_verification",
    role: "reviewer",
    state: { ...state, stageData: { ...state.stageData, lifecyclePlanHash: planHash } },
    paths,
    assertLease,
    run: async (authority) => {
      const observed = await reviewKnowledgeJson({
        budget: {
          batchId: `${state.obligationId}:${planHash}:lifecycle`,
          maximumCalls: Math.min(3, authority.delegation.resourceCeilings.maximumProviderCalls),
        },
        context,
        state,
        authority,
        prompt: LIFECYCLE_PLAN_REVIEW_PROMPT,
        task: LIFECYCLE_PLAN_REVIEW_TASK,
        schema: lifecyclePlanReviewSchema,
        accept: lifecyclePlanReviewVerdict,
        binding: { planHash },
        contextDocuments: review.context,
        contextSkips: review.contextSkips,
        untrustedSourceData: {
          plan: review.disclosedPlan,
          sources: review.sources,
          context: review.context,
          changedPaths: [...new Set(paths)].sort(),
          managedTargets: convergenceManagedKnowledgeRoots,
        },
      });
      // ADR-0604: a malformed answer is not a rejection; it settles as invalid with its evidence.
      let verdict: ReturnType<typeof lifecyclePlanReviewVerdict>;
      try {
        verdict = lifecyclePlanReviewVerdict(observed.value);
      } catch (error) {
        throw Object.assign(error as Error, { dependencyHash: observed.observationArtifactHash });
      }
      if (!verdict.approved) {
        const evidence = await context.storage.artifacts.put(
          canonicalJson({
            schemaVersion: 1,
            planHash,
            verdict: observed.value,
            usage: observed.usage,
            reviewerAgentId: authority.agent.agentId,
          }),
        );
        // ADR-0485: the stage isolates this exact plan by its hash and the reviewer's reason.
        throw Object.assign(
          new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_rejected"),
          {
            dependencyHash: evidence.contentHash,
            lifecyclePlanRejection: {
              planHash,
              rationale: verdict.rationale,
            },
          },
        );
      }
      return {
        state: "current",
        input: {
          ...state,
          stageData: {
            ...state.stageData,
            lifecycleApproval: {
              planHash,
              reviewerAgentId: authority.agent.agentId,
              rationale: verdict.rationale,
            },
          },
        },
        assignmentId: null,
        leaseGeneration: null,
        failureCode: null,
        dependencyHash: null,
        nextStage: "lifecycle_verification",
      };
    },
  });
  return result.input.stageData.lifecycleApproval as {
    planHash: string;
    reviewerAgentId: string;
    rationale: string;
  };
}
