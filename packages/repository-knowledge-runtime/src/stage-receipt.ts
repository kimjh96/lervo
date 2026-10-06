import {
  assertConvergenceEffectSources,
  type ConvergenceApprovedEffect,
} from "./effect-source-fence.js";
import {
  canonicalJson,
  type KnowledgeConvergenceInput,
  type KnowledgeConvergenceStageResult,
} from "@lervo/repository-knowledge";
import type { KnowledgeConvergenceStage } from "@lervo/schemas";
import type { ArtifactStore } from "@lervo/storage-contract";

import { captureConvergenceSources } from "./source-capture.js";
import { convergenceEvaluationContract } from "./evaluation-contract.js";

export async function completeConvergenceStage(input: {
  repositoryRoot: string;
  artifacts: ArtifactStore;
  state: KnowledgeConvergenceInput;
  stage: KnowledgeConvergenceStage;
  nextStage: KnowledgeConvergenceStage | null;
  stageData: Record<string, unknown>;
  proof: unknown;
  approvedEffects?: ConvergenceApprovedEffect[];
  knowledgeSnapshotHash?: string;
  /** This stage's own commit of settled outputs, verified as a child of the observed HEAD. */
  committedHead?: { before: string; after: string };
}): Promise<KnowledgeConvergenceStageResult> {
  const capture = captureConvergenceSources(input.repositoryRoot, input.state.baseline.policyHash);
  assertConvergenceEffectSources(input.state, capture, input.approvedEffects, input.committedHead);
  const proof = await input.artifacts.put(
    canonicalJson({
      schemaVersion: 1,
      obligationId: input.state.obligationId,
      stage: input.stage,
      sourceSnapshotHash: input.state.snapshotHash,
      resultSnapshotHash: capture.snapshotHash,
      policyHash: input.state.baseline.policyHash,
      delegationHash: input.state.baseline.delegationHash,
      proof: input.proof,
      previousReceipt:
        input.state.receipts.findLast((receipt) => receipt.stage === input.stage)?.artifactHash ??
        null,
      approvedEffects: input.approvedEffects ?? [],
      committedHead: input.committedHead ?? null,
    }),
  );
  const state: KnowledgeConvergenceInput = {
    ...input.state,
    snapshotHash: capture.snapshotHash,
    receipts: [
      ...input.state.receipts.filter((receipt) => receipt.stage !== input.stage),
      { stage: input.stage, artifactHash: proof.contentHash, snapshotHash: capture.snapshotHash },
    ],
    stageData: { ...input.state.stageData, ...input.stageData, sourceCapture: capture },
  };
  return {
    state: "current",
    input: state,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: null,
    dependencyHash: null,
    nextStage: input.nextStage,
    ...(input.knowledgeSnapshotHash === undefined
      ? {}
      : { knowledgeSnapshotHash: input.knowledgeSnapshotHash }),
  };
}

export async function waitingConvergenceStage(input: {
  artifacts: ArtifactStore;
  state: KnowledgeConvergenceInput;
  reason: string;
  dependency: unknown;
  kind?: "waiting_authority" | "attention_required" | "recovery_required";
}): Promise<KnowledgeConvergenceStageResult> {
  // ADR-0483: the settled stall names the logic that evaluated it.
  const dependency = await input.artifacts.put(
    canonicalJson(
      input.dependency !== null && typeof input.dependency === "object"
        ? { ...input.dependency, evaluationContract: convergenceEvaluationContract() }
        : input.dependency,
    ),
  );
  return {
    state: input.kind ?? "waiting_authority",
    input: input.state,
    assignmentId: null,
    leaseGeneration: null,
    failureCode: input.reason,
    dependencyHash: dependency.contentHash,
    nextStage: null,
  };
}
