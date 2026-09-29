import {
  canonicalJson,
  replayKnowledgeConvergence,
  sha256,
  type KnowledgeConvergenceInput,
} from "@lervo/repository-knowledge";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { CanonicalBatch } from "./canonical-review.js";
import { completeConvergenceStage } from "./stage-receipt.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Reuse an exact historical rejection when an upgraded owner resumes its queued successor. */
export async function retainedCanonicalRejection(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  batch: CanonicalBatch,
): Promise<{ artifactHash: string; result: unknown } | null> {
  const latest = replayKnowledgeConvergence(context.storage.events).find(
    (row) => row.baseline.payload.obligationId === state.obligationId,
  )?.latest;
  if (latest?.payload.stage !== "canonical_review" || latest.payload.state !== "queued")
    return null;
  const previous = context.storage.events.get(latest.payload.predecessorEventId);
  if (
    previous?.type !== "repository.knowledge.stage.recorded" ||
    previous.payload.obligationId !== state.obligationId ||
    previous.payload.snapshotHash !== state.snapshotHash ||
    previous.payload.stage !== "canonical_review" ||
    previous.payload.state !== "attention_required" ||
    previous.payload.failureCode !== "knowledge_semantic_review_rejected" ||
    typeof previous.payload.dependencyHash !== "string"
  )
    return null;
  const artifactHash = previous.payload.dependencyHash;
  const bytes = await context.storage.artifacts.get(`lervo-cas://sha256/${artifactHash.slice(7)}`);
  if (bytes.byteLength > 64 * 1024 || sha256(bytes) !== artifactHash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  const value = JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as {
    kind?: string;
    snapshotHash?: string;
    assessmentHash?: string;
    result?: unknown;
  };
  if (
    value.kind !== "canonical_rejection" ||
    value.snapshotHash !== state.snapshotHash ||
    value.assessmentHash !== sha256(canonicalJson(batch.assessment))
  )
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  return { artifactHash, result: value.result };
}

/** A rejected canonical proposal authorizes no integration and never becomes semantic coverage. */
export async function continueNormalizationAfterCanonicalRejection(input: {
  context: ConvergenceRuntimeContext;
  state: KnowledgeConvergenceInput;
  batch: CanonicalBatch;
  rejection: unknown;
}) {
  const artifact = await input.context.storage.artifacts.put(
    canonicalJson({
      kind: "canonical_rejection",
      snapshotHash: input.state.snapshotHash,
      assessmentHash: sha256(canonicalJson(input.batch.assessment)),
      rejection: input.rejection,
      sourceBindings: input.batch.sources.map(({ path, contentHash }) => ({ path, contentHash })),
      retainedForNormalization: true,
    }),
  );
  return completeConvergenceStage({
    repositoryRoot: input.context.storage.paths.repositoryRoot,
    artifacts: input.context.storage.artifacts,
    state: input.state,
    stage: "canonical_review",
    nextStage: "normalization_generation",
    stageData: {
      canonicalRejection: { artifactHash: artifact.contentHash },
      canonicalBatch: null,
      canonicalApproval: null,
    },
    proof: { status: "rejection_retained", rejectionArtifactHash: artifact.contentHash },
  });
}
