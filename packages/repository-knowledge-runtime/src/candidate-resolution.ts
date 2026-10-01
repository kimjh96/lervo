import {
  canonicalJson,
  sha256,
  listCanonicalizationCandidates,
  canonicalizationCandidatePath,
  transitionCanonicalizationCandidate,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import { withConvergenceAssignment } from "./workforce.js";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { reviewKnowledgeJson } from "./provider-call.js";
import { loadCanonicalReviewContext } from "./review-context.js";
import { convergenceSourceBytes } from "./source-capture.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import {
  candidateReviewPrompt,
  candidateReviewSchema,
  parseCandidateReview,
  type CandidateReview,
} from "./candidate-review-contract.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";

/** Old candidate closure needs a distinct exact semantic decision; baseline coverage alone grants none. */
export async function resolveConvergenceCandidates(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult | null> {
  const root = context.storage.paths.repositoryRoot;
  const review = state.stageData.candidateReview as CandidateReview | null | undefined;
  const candidates = (await listCanonicalizationCandidates(root))
    .filter((item) => ["candidate", "pending", "stale"].includes(item.observedState))
    // Source-specific context cannot cover unrelated candidates in one bounded review.
    .slice(0, 1);
  if (!review && !candidates.length) return null;
  if (!review) {
    const paths = [
      ...new Set(
        candidates.flatMap((candidate) => candidate.sourceBindings.map((binding) => binding.path)),
      ),
    ];
    const documents = await loadCanonicalReviewContext({
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
          schema: candidateReviewSchema,
          untrustedSourceData: {
            candidates,
            sources,
            context: documents,
            canonicalCoverage: state.stageData.canonicalCoverage,
          },
        });
        const decisions = parseCandidateReview(observed.value, candidates, documents);
        if (decisions.some((decision) => decision.decision === "defer"))
          return waitingConvergenceStage({
            artifacts: context.storage.artifacts,
            state,
            kind: "attention_required",
            reason: "knowledge_semantic_review_rejected",
            dependency: {
              snapshotHash: state.snapshotHash,
              delegationHash: state.baseline.delegationHash,
              decisions,
            },
          });
        return completeConvergenceStage({
          repositoryRoot: root,
          artifacts: context.storage.artifacts,
          state,
          stage: "lifecycle_verification",
          nextStage: "lifecycle_verification",
          stageData: {
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
        await authority.assertCurrent();
        context.assertSource(state);
        const current = (await listCanonicalizationCandidates(root)).find(
          (item) => item.candidateId === decision.candidateId,
        );
        // A crashed application can already have written exactly this review; never repeat its transition.
        if (
          (current?.review?.reviewerId === review.reviewerAgentId &&
            current.state === "rejected" &&
            decision.decision === "reject") ||
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
      return completeConvergenceStage({
        repositoryRoot: root,
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
