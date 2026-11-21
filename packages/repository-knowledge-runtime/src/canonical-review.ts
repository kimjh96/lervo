import {
  canonicalJson,
  sha256,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { reviewKnowledgeJson } from "./provider-call.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import type {
  CanonicalAssessment,
  CanonicalAssessmentSource,
} from "./canonical-assessment-contract.js";
import type { SemanticReviewContextDocument, ReviewContextSkip } from "./review-context.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { retainedCanonicalRejection } from "./canonical-rejection.js";
import { isolateRejectedCanonicalBatch } from "./canonical-isolation.js";
import { convergenceSourceObservation } from "./source-observation.js";
import { contextDocumentReferences, contextDocumentView } from "./review-context-references.js";
import {
  CANONICAL_REVIEW_PROMPT,
  canonicalReviewSchema,
  parseCanonicalReview,
  retainedCanonicalReview,
  type CanonicalReviewResult,
} from "./canonical-review-contract.js";

export interface CanonicalBatch {
  offset: number;
  count: number;
  assessment: CanonicalAssessment;
  sources: CanonicalAssessmentSource[];
  sourceFacts?: (
    | ReturnType<typeof import("./canonical-source-facts.js").canonicalSourceFacts>[number]
    | ReturnType<
        typeof import("./canonical-release-manifest-facts.js").canonicalReleaseManifestFacts
      >[number]
  )[];
  context: SemanticReviewContextDocument[];
  contextSkips?: ReviewContextSkip[];
  documentLayout?: Awaited<
    ReturnType<typeof import("./canonical-layout.js").canonicalDocumentLayout>
  >["guidance"];
  batchId: string;
  generatorAgentId: string;
}
export async function reviewCanonicalBaseline(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const batch = state.stageData.canonicalBatch as CanonicalBatch | null;
  if (batch === null)
    return completeConvergenceStage({
      sources: convergenceSourceObservation(context),
      artifacts: context.storage.artifacts,
      state,
      stage: "canonical_review",
      nextStage: "canonical_integration",
      stageData: { canonicalApproval: null },
      proof: { status: "empty_scope" },
    });
  if (!batch || !Array.isArray(batch.sources))
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  // A rejection recorded before an upgrade is reused without another review call (ADR-0435).
  const retained = await retainedCanonicalRejection(context, state, batch);
  if (retained !== null) {
    const result = retainedCanonicalReview(retained.result, batch);
    if (
      result.decision !== "reject" &&
      !batch.assessment.decisions.some((decision) => decision.disposition === "needs_review")
    )
      throw new KnowledgeConvergenceRuntimeError("knowledge_semantic_review_invalid");
    return rejectedCanonicalBatch(context, state, batch, result, { retainedArtifact: retained });
  }
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "canonical_review",
    role: "reviewer",
    state,
    paths: batch.sources.map((source) => source.path),
    assertLease,
    run: async (authority) => {
      if (authority.agent.agentId === batch.generatorAgentId)
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      const observed = await reviewKnowledgeJson({
        budget: {
          batchId: `${batch.batchId}:review`,
          maximumCalls: Math.min(3, authority.delegation.resourceCeilings.maximumProviderCalls),
        },
        context,
        state,
        authority,
        prompt: CANONICAL_REVIEW_PROMPT,
        task: "independent_canonical_review",
        schema: canonicalReviewSchema,
        accept: (value: unknown) => parseCanonicalReview(value, batch),
        contextDocuments: batch.context,
        contextSkips: batch.contextSkips ?? [],
        // ADR-0604: the reviewer judges the batch and cites nothing; Lervo binds its hashes. It
        // sees the context exactly as the generator did.
        untrustedSourceData: {
          ...batch,
          context: contextDocumentView(contextDocumentReferences(batch.context)),
        },
      });
      const result = parseCanonicalReview(observed.value, batch);
      if (
        result.decision === "reject" ||
        batch.assessment.decisions.some((decision) => decision.disposition === "needs_review")
      )
        return rejectedCanonicalBatch(context, state, batch, result, { usage: observed.usage });
      return completeConvergenceStage({
        sources: convergenceSourceObservation(context),
        artifacts: context.storage.artifacts,
        state,
        stage: "canonical_review",
        nextStage: "canonical_integration",
        stageData: {
          canonicalReviewRetry: null,
          canonicalApproval: {
            ...result,
            reviewerAgentId: authority.agent.agentId,
            assignmentId: authority.assignment.assignmentId,
            delegationHash: state.baseline.delegationHash,
            policyHash: state.baseline.policyHash,
          },
        },
        proof: { ...result, usage: observed.usage, reviewerAgentId: authority.agent.agentId },
      });
    },
  });
}

/**
 * ADR-0479: one bounded re-assessment with the reviewer's rationale, then isolation. Rejection never
 * stops the pipeline; an isolated single source is parked and the remaining sources continue.
 * ADR-0561: a source its generator marked `needs_review` regenerates once like any rejection, then
 * parks as Lervo debt; it is never parked at once as an owner decision.
 */
async function rejectedCanonicalBatch(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  batch: CanonicalBatch,
  result: CanonicalReviewResult,
  evidence: unknown,
): Promise<KnowledgeConvergenceStageResult> {
  const assessmentHash = sha256(canonicalJson(batch.assessment));
  const previousRetry = state.stageData.canonicalReviewRetry as
    { offset: number; count: number; rationale: string } | null | undefined;
  const retried = previousRetry?.offset === batch.offset ? previousRetry.count : 0;
  if (retried < 1)
    return completeConvergenceStage({
      sources: convergenceSourceObservation(context),
      artifacts: context.storage.artifacts,
      state,
      stage: "canonical_review",
      nextStage: "assessment",
      stageData: {
        canonicalBatch: null,
        canonicalApproval: null,
        canonicalReviewRetry: { offset: batch.offset, count: 1, rationale: result.rationale },
      },
      proof: {
        status: "review_rejected_for_bounded_retry",
        assessmentHash,
        review: result,
        evidence,
      },
    });
  return isolateRejectedCanonicalBatch({
    context,
    state,
    batch,
    rejection: result,
    attempts: retried + 1,
  });
}
