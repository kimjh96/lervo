import { assertConvergenceDelegation } from "./delegation.js";
import type { captureConvergenceSources } from "./source-capture.js";
import {
  canonicalJson,
  sha256,
  compileConfiguredDocumentNormalizationCandidateObserved,
  inspectConfiguredDocumentNormalization,
  storeDocumentNormalizationCandidate,
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
import type { ConvergenceRuntimeContext } from "./stage-context.js";

export interface NormalizationBatch {
  candidateId: string;
  batchId: string;
  paths: string[];
  generatedInputHash: string;
  maximumCalls: number;
}

export async function generateNormalizationBatch(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  assertLease: () => void,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const inspection = await inspectConfiguredDocumentNormalization({ repositoryRoot: root });
  const rejected = (state.stageData.normalizationRejected ?? {}) as Record<string, string>;
  const sources = new Map(
    (
      (state.stageData.sourceCapture as ReturnType<typeof captureConvergenceSources> | undefined)
        ?.sources ?? state.baseline.sources
    ).map((source) => [source.path, source.contentHash]),
  );
  const available = inspection.pendingDocuments.filter(
    (path) => rejected[path] !== sources.get(path),
  );
  if (!available.length) {
    if (inspection.pendingDocuments.length)
      return waitingConvergenceStage({
        artifacts: context.storage.artifacts,
        state,
        reason: "knowledge_semantic_review_rejected",
        kind: "attention_required",
        dependency: {
          schemaVersion: 1,
          kind: "normalization_rejection",
          snapshotHash: state.snapshotHash,
          rejected,
        },
      });
    return completeConvergenceStage({
      repositoryRoot: root,
      artifacts: context.storage.artifacts,
      state,
      stage: "normalization_generation",
      nextStage: "normalization_review",
      stageData: { normalizationBatch: null },
      proof: { status: "already_current", inspection },
    });
  }
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
  const scoped = rotated.filter((path) =>
    pathWithinConvergenceRoots(path, delegation.normalizationRoots),
  );
  let sourceBytes = 0;
  const selected = scoped.slice(0, delegation.resourceCeilings.maximumDocuments).filter((path) => {
    sourceBytes += convergenceSourceBytes(root, path).byteLength;
    return sourceBytes <= delegation.resourceCeilings.maximumSourceBytes;
  });
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
  return withConvergenceAssignment({
    storage: context.storage,
    provider: context.provider,
    stage: "normalization_generation",
    role: "generator",
    state,
    paths: selected,
    assertLease,
    run: (authority) => generate(context, state, selected, authority),
  });
}

async function generate(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  paths: string[],
  authority: ConvergenceAssignmentAuthority,
): Promise<KnowledgeConvergenceStageResult> {
  const root = context.storage.paths.repositoryRoot;
  const ceilings = authority.delegation.resourceCeilings;
  const selected: string[] = [];
  let bytes = 0;
  for (const path of paths) {
    if (!pathWithinConvergenceRoots(path, authority.delegation.normalizationRoots)) continue;
    const size = convergenceSourceBytes(root, path).byteLength;
    if (selected.length >= ceilings.maximumDocuments || bytes + size > ceilings.maximumSourceBytes)
      break;
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
  const batchId = sha256(canonicalJson([state.obligationId, selected, state.snapshotHash]));
  const compiler = await createProcessDocumentNormalizationCompiler({
    provider: context.provider,
    ...(context.executable === undefined ? {} : { executable: context.executable }),
    timeoutMs: 300_000,
  });
  const normalize: NonNullable<
    RepositoryDocumentNormalizationCompiler["normalizeObserved"]
  > = async (envelope, signal) => {
    // Reserve one of the total eight calls for the independent reviewer, including fallback calls.
    return withKnowledgeProviderAdmission({
      budget: { batchId, maximumCalls: ceilings.maximumProviderCalls - 1 },
      context,
      state,
      authority,
      run: (_observationHash, currentSignal) =>
        compiler.normalizeObserved!(envelope, AbortSignal.any([signal, currentSignal])),
    });
  };
  const wrapped: RepositoryDocumentNormalizationCompiler = {
    descriptor: compiler.descriptor,
    normalizeObserved: normalize,
    normalize: async (envelope, signal) => (await normalize(envelope, signal)).response,
  };
  const compilation = await compileConfiguredDocumentNormalizationCandidateObserved({
    repositoryRoot: root,
    compiler: wrapped,
    signal: context.signal,
    sourcePaths: selected,
    ceilings: {
      maximumSourceBytes: ceilings.maximumSourceBytes,
      maximumProviderCalls: ceilings.maximumProviderCalls - 1,
      maximumElapsedMilliseconds: 25 * 60_000,
    },
  });
  await authority.assertCurrent();
  context.assertSource(state);
  await storeDocumentNormalizationCandidate({
    repositoryRoot: root,
    candidate: compilation.candidate,
  });
  const batch: NormalizationBatch = {
    candidateId: compilation.candidate.candidateId,
    batchId,
    paths: selected,
    generatedInputHash: sha256(canonicalJson(state)),
    maximumCalls: ceilings.maximumProviderCalls,
  };
  return completeConvergenceStage({
    repositoryRoot: root,
    artifacts: context.storage.artifacts,
    state,
    stage: "normalization_generation",
    nextStage: "normalization_review",
    stageData: { normalizationBatch: batch },
    proof: {
      batch,
      resourceObservation: compilation.resourceObservation,
      generatorAgentId: authority.agent.agentId,
      assignmentId: authority.assignment.assignmentId,
    },
  });
}
