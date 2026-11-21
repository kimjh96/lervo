import { admittedBackgroundContext, backgroundProviderOptions } from "./background-provider.js";
import { assertConvergenceDelegation } from "./delegation.js";
import type { captureConvergenceSources } from "./source-capture.js";
import {
  canonicalJson,
  sha256,
  compileConfiguredDocumentNormalizationCandidateObserved,
  inspectConfiguredDocumentNormalization,
  storeDocumentNormalizationCandidate,
  type DocumentNormalizationReviewFeedback,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
  type RepositoryDocumentNormalizationCompiler,
} from "@lervo/repository-knowledge";
import { createProcessDocumentNormalizationCompiler } from "@lervo/repository-knowledge-compiler";
import { completeConvergenceStage, waitingConvergenceStage } from "./stage-receipt.js";
import { withConvergenceAssignment, type ConvergenceAssignmentAuthority } from "./workforce.js";
import { pathWithinConvergenceRoots } from "./delegation.js";
import { convergenceSourceBytes } from "./source-capture.js";
import { withKnowledgeProviderAdmission } from "./provider-call.js";
import { selectNormalizationBatchWithinCallBudget } from "./normalization-batch-selection.js";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import {
  NORMALIZATION_OUTSIDE_DELEGATION,
  normalizationScopeGap,
} from "./normalization-scope-gap.js";
import {
  carriedParkedSources,
  mergeParkedSources,
  obligationParkedSources,
  type ParkedConvergenceSource,
} from "./convergence-parking.js";
import { admitNormalizationDocuments, normalizationRejections } from "./normalization-rejection.js";
import { packNormalizationDocuments } from "./normalization-packing.js";
import {
  normalizationCostKey,
  normalizationLearnedLimit,
} from "./normalization-cost-controller.js";
import { convergenceSourceObservation } from "./source-observation.js";
import { isUpgradePreemption } from "./upgrade-preemption.js";
import { normalizationMayRewrite } from "./normalization-protected-paths.js";

export interface NormalizationBatch {
  candidateId: string;
  batchId: string;
  paths: string[];
  generatedInputHash: string;
  maximumCalls: number;
  costKey?: string;
}

/**
 * A batch whose independent review timed out is regenerated with half as many documents, down to
 * one. The limit lives in the obligation's stage data, so a later baseline starts from the
 * delegated ceiling again.
 */
export function halvedNormalizationDocumentLimit(documents: number): number {
  return Math.max(1, Math.floor(documents / 2));
}

function normalizationDocumentLimit(state: KnowledgeConvergenceInput, ceiling: number): number {
  const limit = state.stageData.normalizationDocumentLimit;
  return typeof limit === "number" && Number.isSafeInteger(limit) && limit >= 1
    ? Math.min(ceiling, limit)
    : ceiling;
}

/**
 * The identity of one generation's call budget. Each regeneration attempt is its own bounded
 * batch; a first generation keeps its identity. ADR-0604: so is a regeneration after a stale
 * candidate, which the apply stage bounds, so a lifecycle move never spends the calls the batch
 * had left for its review.
 */
export function normalizationGenerationBatchId(
  state: KnowledgeConvergenceInput,
  paths: readonly string[],
  attempts: readonly (readonly [string, number])[],
): string {
  const stale = state.stageData.normalizationStaleCandidateId;
  return sha256(
    canonicalJson([
      state.obligationId,
      paths,
      state.snapshotHash,
      ...(attempts.length ? [attempts] : []),
      ...(typeof stale === "string" ? [{ stale }] : []),
    ]),
  );
}

export async function generateNormalizationBatch(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const inspection = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
  const sources = new Map(
    (
      (state.stageData.sourceCapture as ReturnType<typeof captureConvergenceSources> | undefined)
        ?.sources ?? state.baseline.sources
    ).map((source) => [source.path, source.contentHash]),
  );
  const admission = admitNormalizationDocuments(
    // ADR-0594: a protected skill path never holds the pipeline, like a parked document.
    inspection.pendingDocuments.filter(normalizationMayRewrite),
    sources,
    normalizationRejections(state),
    mergeParkedSources(
      await carriedParkedSources(context.storage, state),
      obligationParkedSources(state),
    ),
  );
  const available = admission.fresh.length
    ? admission.fresh
    : [...admission.regenerate.keys()].toSorted();
  if (!available.length)
    // ADR-0479: parked documents never hold the pipeline; later stages still run.
    return completeConvergenceStage({
      sources: convergenceSourceObservation(context),
      artifacts: context.storage.artifacts,
      state,
      stage: "normalization_generation",
      nextStage: "normalization_review",
      stageData: { normalizationBatch: null, parkedSources: admission.parked },
      proof: {
        status: admission.parked.length ? "remaining_documents_parked" : "already_current",
        inspection,
        parkedSources: admission.parked.map(({ path, contentHash }) => ({ path, contentHash })),
      },
    });
  // Rotate lexicographically after the last family, so rejected families cannot monopolize a cycle.
  const cursor =
    typeof state.stageData.normalizationCursor === "string"
      ? state.stageData.normalizationCursor
      : "";
  const sorted = available.toSorted();
  const rotated = [
    ...sorted.filter((path) => path > cursor),
    ...sorted.filter((path) => path <= cursor),
  ];
  const delegation = await assertConvergenceDelegation({
    repositoryRoot: root,
    projectId: state.baseline.projectId,
    expectedHash: state.baseline.delegationHash,
    provider: context.provider,
  });
  const scoped = rotated.filter(
    (path) =>
      pathWithinConvergenceRoots(path, delegation.normalizationRoots) &&
      normalizationMayRewrite(path),
  );
  if (!scoped.length)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      reason: NORMALIZATION_OUTSIDE_DELEGATION,
      dependency: normalizationScopeGap(state, sorted),
    });
  const admittedContext = await admittedBackgroundContext(context);
  const compiler = await createProcessDocumentNormalizationCompiler({
    ...backgroundProviderOptions(admittedContext),
    timeoutMs: 600_000,
  });
  const sizes = new Map<string, number>();
  const packed = packNormalizationDocuments({
    paths: scoped,
    maximumDocuments: admission.fresh.length ? delegation.resourceCeilings.maximumDocuments : 1,
    maximumBytes: delegation.resourceCeilings.maximumSourceBytes,
    size: (path) => {
      const size = convergenceSourceBytes(root, path).byteLength;
      sizes.set(path, size);
      return size;
    },
  });
  const costKey = normalizationCostKey(
    compiler.descriptor,
    Math.max(0, ...packed.map((path) => sizes.get(path)!)),
  );
  const documentLimit = normalizationDocumentLimit(
    state,
    await normalizationLearnedLimit(root, costKey, delegation.resourceCeilings.maximumDocuments),
  );
  // A regeneration carries one document's reasons, so its review isolates that document.
  const selected = packed.slice(0, admission.fresh.length ? documentLimit : 1);
  if (!selected.length)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      reason: "knowledge_authority_unavailable",
      dependency: {
        kind: "normalization_scope",
        snapshotHash: state.snapshotHash,
        delegationHash: state.baseline.delegationHash,
      },
    });
  if (delegation.resourceCeilings.maximumProviderCalls < 2)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      reason: "knowledge_authority_unavailable",
      dependency: {
        kind: "normalization_scope",
        snapshotHash: state.snapshotHash,
        delegationHash: state.baseline.delegationHash,
      },
    });
  const bounded = await selectNormalizationBatchWithinCallBudget({
    repositoryRoot: root,
    paths: selected,
    compiler,
    maximumSourceBytes: delegation.resourceCeilings.maximumSourceBytes,
    maximumProviderCalls: delegation.resourceCeilings.maximumProviderCalls,
  });
  if (bounded.length === 0)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      reason: "knowledge_authority_unavailable",
      dependency: normalizationScopeGap(state, selected),
    });
  return withConvergenceAssignment({
    storage: context.storage,
    provider: admittedContext.provider,
    stage: "normalization_generation",
    role: "generator",
    state,
    paths: bounded,
    assertLease,
    run: (authority) =>
      generate(admittedContext, state, bounded, authority, compiler, {
        feedback: new Map(
          bounded.flatMap((path) => {
            const feedback = admission.regenerate.get(path);
            return feedback === undefined ? [] : [[path, feedback] as const];
          }),
        ),
        parkedSources: admission.parked,
        costKey,
      }),
  });
}

async function generate(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  paths: string[],
  authority: ConvergenceAssignmentAuthority,
  compiler: RepositoryDocumentNormalizationCompiler,
  regeneration: {
    feedback: ReadonlyMap<string, DocumentNormalizationReviewFeedback>;
    parkedSources: ParkedConvergenceSource[];
    costKey: string;
  },
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const ceilings = authority.delegation.resourceCeilings;
  const selected: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    if (
      !pathWithinConvergenceRoots(path, authority.delegation.normalizationRoots) ||
      !normalizationMayRewrite(path)
    )
      continue;
    const size = convergenceSourceBytes(root, path).byteLength;
    if (selected.length >= ceilings.maximumDocuments || bytes + size > ceilings.maximumSourceBytes)
      continue;
    selected.push(path);
    bytes += size;
  }
  if (!selected.length || ceilings.maximumProviderCalls < 2)
    return waitingConvergenceStage({
      artifacts: context.storage.artifacts,
      state,
      reason: "knowledge_authority_unavailable",
      dependency: {
        kind: "normalization_scope",
        snapshotHash: state.snapshotHash,
        delegationHash: state.baseline.delegationHash,
      },
    });
  const attempts = selected.flatMap((path) => {
    const feedback = regeneration.feedback.get(path);
    return feedback === undefined ? [] : [[path, feedback.attempt] as const];
  });
  const batchId = normalizationGenerationBatchId(state, selected, attempts);
  // ADR-0587: a call abandoned for an upgrade stops the whole compilation. Without this, the
  // compiler retries a multi-document shard one document at a time, and its elapsed or call
  // ceiling can fail the stage instead of deferring it.
  const preemption = new AbortController();
  const normalize: NonNullable<
    RepositoryDocumentNormalizationCompiler["normalizeObserved"]
  > = async (envelope, signal) => {
    try {
      // Reserve one of the total eight calls for the independent reviewer, including fallback calls.
      return await withKnowledgeProviderAdmission({
        budget: { batchId, maximumCalls: ceilings.maximumProviderCalls - 1 },
        context,
        state,
        authority,
        run: (_observationHash, currentSignal) =>
          compiler.normalizeObserved!(envelope, AbortSignal.any([signal, currentSignal])),
      });
    } catch (error) {
      if (isUpgradePreemption(error)) preemption.abort(error);
      throw error;
    }
  };
  const wrapped: RepositoryDocumentNormalizationCompiler = {
    descriptor: compiler.descriptor,
    normalizeObserved: normalize,
    normalize: async (envelope, signal) => (await normalize(envelope, signal)).response,
  };
  let compilation: Awaited<
    ReturnType<typeof compileConfiguredDocumentNormalizationCandidateObserved>
  >;
  try {
    compilation = await compileConfiguredDocumentNormalizationCandidateObserved({
      repositoryRoot: root,
      compiler: wrapped,
      signal: AbortSignal.any([context.signal, preemption.signal]),
      sourcePaths: selected,
      ...(attempts.length ? { reviewFeedback: regeneration.feedback } : {}),
      ceilings: {
        maximumSourceBytes: ceilings.maximumSourceBytes,
        maximumProviderCalls: ceilings.maximumProviderCalls - 1,
        maximumElapsedMilliseconds: 25 * 60_000,
      },
    });
  } catch (error) {
    // Whatever a concurrent shard reported after the abandonment, the stage defers for the upgrade.
    if (preemption.signal.aborted && !context.signal.aborted) throw preemption.signal.reason;
    throw error;
  }
  await authority.assertCurrent();
  context.assertSourceExact(state);
  await storeDocumentNormalizationCandidate({
    repositoryRoot: root,
    candidate: compilation.candidate,
  });
  context.sourceObservation?.noteChange();
  const batch: NormalizationBatch = {
    candidateId: compilation.candidate.candidateId,
    batchId,
    paths: selected,
    generatedInputHash: sha256(canonicalJson(state)),
    maximumCalls: ceilings.maximumProviderCalls,
    costKey: regeneration.costKey,
  };
  return completeConvergenceStage({
    sources: convergenceSourceObservation(context),
    artifacts: context.storage.artifacts,
    state,
    stage: "normalization_generation",
    nextStage: "normalization_review",
    stageData: { normalizationBatch: batch, parkedSources: regeneration.parkedSources },
    proof: {
      batch,
      regenerationAttempts: attempts,
      resourceObservation: compilation.resourceObservation,
      generatorAgentId: authority.agent.agentId,
      assignmentId: authority.assignment.assignmentId,
    },
  });
}
