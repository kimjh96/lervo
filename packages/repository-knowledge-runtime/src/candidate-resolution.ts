import {
  canonicalJson,
  sha256,
  canonicalizationCandidateHeld,
  listCanonicalizationCandidates,
  canonicalizationCandidatePath,
  transitionCanonicalizationCandidate,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import { reviewKnowledgeJson } from "./provider-call.js";
import { loadCanonicalReviewContext } from "./review-context.js";
import { convergenceSourceBytes } from "./source-capture.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  candidateReviewContract,
  candidateReviewPrompt,
  type CandidateReview,
} from "./candidate-review-contract.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/** The reviewer's first deferral, given back as evidence when the review regenerates once. */
interface CandidateReviewRetry {
  candidateId: string;
  contentHash: string;
  rationale: string;
}

function reviewRetry(state: KnowledgeConvergenceInput): CandidateReviewRetry | null {
  const value = state.stageData.candidateReviewRetry as Partial<CandidateReviewRetry> | null;
  return value !== null &&
    typeof value === "object" &&
    typeof value.candidateId === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.rationale === "string"
    ? (value as CandidateReviewRetry)
    : null;
}

/**
 * Old candidate closure needs a distinct exact semantic decision; baseline coverage alone grants
 * none. Under ADR-0561 the background reviewer resolves every candidate, including one an agent
 * declared `pending_user_approval`, and nothing waits for the owner: a deferral regenerates the
 * review once with the deferral as evidence, and a second deferral holds the candidate as Lervo
 * debt until its sources change.
 */
export async function resolveConvergenceCandidates(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult | null> {
  const root = context.storage.paths.repositoryRoot;
  const review = state.stageData.candidateReview as CandidateReview | null | undefined;
  const candidates = (await listCanonicalizationCandidates(root))
    .filter(
      (item) =>
        ["candidate", "pending", "stale"].includes(item.observedState) &&
        !(item.observedState === "pending" && canonicalizationCandidateHeld(item)),
    )
    // Source-specific context cannot cover unrelated candidates in one bounded review.
    .slice(0, 1);
  if (!review && !candidates.length) return null;
  const prior = reviewRetry(state);
  const retry =
    prior !== null &&
    candidates.some(
      (item) => item.candidateId === prior.candidateId && item.contentHash === prior.contentHash,
    )
      ? prior
      : null;
  if (!review) {
    const paths = [
      ...new Set(
        candidates.flatMap((candidate) => candidate.sourceBindings.map((binding) => binding.path)),
      ),
    ];
    const { documents, skipped: contextSkips } = await loadCanonicalReviewContext({
      repositoryRoot: root,
      sourcePaths: paths,
    });
    const sources = state.baseline.sources
      .filter((source) => paths.includes(source.path))
      .map((source) => ({
        ...source,
        ...(source.kind === "text" &&
        state.baseline.sourceDispositions?.find((item) => item.path === source.path)?.kind ===
          "semantic_source"
          ? {
              content: new TextDecoder("utf8", { fatal: true }).decode(
                convergenceSourceBytes(root, source.path),
              ),
            }
          : {}),
      }));
    if (Buffer.byteLength(canonicalJson({ candidates, documents, sources })) > 1_048_576)
      throw new KnowledgeConvergenceRuntimeError("knowledge_source_limit_exceeded");
    return withConvergenceAssignment({
      storage: context.storage,
      provider: context.provider,
      stage: "lifecycle_verification",
      role: "reviewer",
      state,
      paths,
      assertLease,
      run: async (authority) => {
        // ADR-0604: the reviewer cites references; the contract maps them back to exact hashes.
        const contract = candidateReviewContract({ candidates, documents, priorDeferral: retry });
        const observed = await reviewKnowledgeJson({
          context,
          state,
          authority,
          budget: {
            batchId: `${state.obligationId}:candidates:${sha256(canonicalJson(candidates))}`,
            maximumCalls: Math.min(3, authority.delegation.resourceCeilings.maximumProviderCalls),
          },
          prompt: candidateReviewPrompt,
          task: "canonical_candidate_resolution",
          schema: contract.schema,
          accept: contract.parse,
          contextDocuments: documents,
          contextSkips,
          untrustedSourceData: {
            ...contract.view,
            sources,
            canonicalCoverage: state.stageData.canonicalCoverage,
          },
        });
        const decisions = contract.parse(observed.value);
        const deferred = decisions.find((decision) => decision.decision === "defer");
        if (deferred !== undefined && retry === null)
          return completeConvergenceStage({
            sources: convergenceSourceObservation(context),
            artifacts: context.storage.artifacts,
            state,
            stage: "lifecycle_verification",
            nextStage: "lifecycle_verification",
            stageData: {
              candidateReviewRetry: {
                candidateId: deferred.candidateId,
                contentHash: deferred.contentHash,
                rationale: deferred.rationale,
              },
            },
            proof: { status: "candidate_review_regenerating", decisions, usage: observed.usage },
          });
        return completeConvergenceStage({
          sources: convergenceSourceObservation(context),
          artifacts: context.storage.artifacts,
          state,
          stage: "lifecycle_verification",
          nextStage: "lifecycle_verification",
          stageData: {
            candidateReviewRetry: null,
            candidateReview: {
              reviewerAgentId: authority.agent.agentId,
              decisions,
              context: documents.map(({ path, contentHash }) => ({ path, contentHash })),
            },
          },
          proof: { decisions, usage: observed.usage },
        });
      },
    });
  }
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "lifecycle_verification",
    role: "writer",
    state,
    paths: review.decisions.map((decision) => canonicalizationCandidatePath(decision.candidateId)),
    assertLease,
    run: async (authority) => {
      if (authority.agent.agentId === review.reviewerAgentId)
        throw new KnowledgeConvergenceRuntimeError("knowledge_authority_unavailable");
      const receipts = [];
      for (const decision of review.decisions) {
        const current = (await listCanonicalizationCandidates(root)).find(
          (item) => item.candidateId === decision.candidateId,
        );
        await authority.assertCurrent();
        // No other await separates this fence from the transition.
        context.assertSourceExact(state);
        // A crashed application can already have written exactly this review; never repeat its transition.
        if (
          (current?.review?.reviewerId === review.reviewerAgentId &&
            ((current.state === "rejected" && decision.decision === "reject") ||
              (current.state === "pending" && decision.decision === "defer"))) ||
          (current?.promotion?.reviewerId === review.reviewerAgentId &&
            current.state === "promoted" &&
            decision.decision === "promote" &&
            current.promotion.targetPath === decision.targetPath &&
            current.promotion.targetContentHash === decision.targetContentHash)
        ) {
          receipts.push(current);
          continue;
        }
        receipts.push(
          await transitionCanonicalizationCandidate({
            repositoryRoot: root,
            candidateId: decision.candidateId,
            expectedContentHash: decision.contentHash,
            action: decision.decision,
            reviewerId: review.reviewerAgentId,
            now: new Date(),
            ...(decision.targetPath === null ? {} : { targetPath: decision.targetPath }),
            ...(decision.targetContentHash === null
              ? {}
              : { targetContentHash: decision.targetContentHash }),
          }),
        );
      }
      context.sourceObservation?.noteChange();
      return completeConvergenceStage({
        sources: convergenceSourceObservation(context),
        artifacts: context.storage.artifacts,
        state,
        stage: "lifecycle_verification",
        nextStage: "lifecycle_verification",
        stageData: { candidateReview: null },
        proof: { review, receipts },
      });
    },
  });
}
