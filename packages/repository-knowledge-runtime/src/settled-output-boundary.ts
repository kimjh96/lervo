import type {
  KnowledgeConvergenceInput,
  KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import type { KnowledgeConvergenceStage } from "@lervo/schemas";

import { commitSettledKnowledgeOutputs } from "./knowledge-output-commit.js";
import { assertConvergenceEffectSources } from "./effect-source-fence.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import { convergenceSourceObservation } from "./source-observation.js";

/**
 * Stages that open a new unit of work. Every earlier materializing stage (canonical integration,
 * normalization apply) is followed by one of these, so its reviewed outputs are committed one
 * stage later instead of waiting for `lifecycle_verification`, which a busy repository may never
 * reach. Mid-batch stages are excluded: their stage events carry review and integration evidence
 * that a commit-only receipt must not impersonate.
 */
const BATCH_START_STAGES: ReadonlySet<KnowledgeConvergenceStage> = new Set([
  "assessment",
  "normalization_generation",
]);

export function settledOutputBoundary(stage: KnowledgeConvergenceStage): boolean {
  return BATCH_START_STAGES.has(stage);
}

/**
 * Commit settled reviewed outputs as their own `Lervo Knowledge` commit. When a commit lands, the
 * stage records only that commit and re-queues itself on the post-commit snapshot, so the HEAD
 * move is this obligation's own fenced effect rather than a reason to supersede it.
 */
export async function commitSettledOutputsAtBoundary(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  stage: KnowledgeConvergenceStage,
): Promise<KnowledgeConvergenceStageResult | null> {
  const root = context.storage.paths.repositoryRoot;
  context.assertSourceExact(state);
  const output = await commitSettledKnowledgeOutputs({
    repositoryRoot: root,
    events: context.storage.events,
    artifacts: context.storage.artifacts,
    obligationId: state.obligationId,
    // Every await of selection and formatting has run; nothing else separates this from `git add`.
    fenceBeforeStaging: (formatEffects) => {
      assertConvergenceEffectSources(
        state,
        convergenceSourceObservation(context).exact(state.baseline.policyHash),
        formatEffects,
      );
    },
  });
  if (output.head === null) return null;
  context.sourceObservation?.noteChange();
  return completeConvergenceStage({
    sources: convergenceSourceObservation(context),
    artifacts: context.storage.artifacts,
    state,
    stage,
    nextStage: stage,
    stageData: {},
    committedHead: output.head,
    // Formatting the committed outputs is this stage's own approved byte change.
    approvedEffects: output.formatEffects ?? [],
    proof: { status: "settled_outputs_committed", head: output.head, paths: output.committed },
  });
}
