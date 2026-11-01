import { sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { EventEnvelope } from "@lervo/schemas";
import { visitEventsOfTypes } from "@lervo/storage-contract";
import type { ConvergenceRuntimeContext } from "./stage-context.js";
import type { ConvergenceApprovedEffect } from "./effect-source-fence.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/**
 * The most recent settled normalizations a lineage proof considers. Every match the former
 * 10,000-event head window held is still among them.
 */
const maximumSettledNormalizations = 10_000;

/** Only canonically settled, independently reviewed normalization can explain a target preimage. */
export async function hasCanonicalNormalizationLineage(
  context: ConvergenceRuntimeContext,
  state: KnowledgeConvergenceInput,
  path: string,
  targetHash: string | null,
  sourceHash: string | null,
): Promise<boolean> {
  if (targetHash === sourceHash) return true;
  if (targetHash === null || sourceHash === null) return false;
  // ADR-0554: a typed read keeps the most recent settled normalizations, whatever the noise
  // between them; the window counts retained matches, never the length of history.
  const settled: EventEnvelope[] = [];
  visitEventsOfTypes({
    events: context.storage.events,
    types: ["repository.knowledge.stage.recorded"],
    throughSeq: context.storage.events.latest()?.seq ?? 0,
    visit: (event) => {
      if (
        event.payload.stage !== "normalization_apply" ||
        event.payload.state !== "current" ||
        event.payload.resultArtifactHash === null
      )
        return;
      settled.push(event);
      if (settled.length > maximumSettledNormalizations) settled.shift();
    },
  });
  const load = async <T>(hash: string): Promise<T> => {
    const bytes = await context.storage.artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
    if (sha256(bytes) !== hash)
      throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
    return JSON.parse(new TextDecoder("utf8", { fatal: true }).decode(bytes)) as T;
  };
  let current = sourceHash;
  let steps = 0;
  for (const event of settled.reverse()) {
    const result = await load<KnowledgeConvergenceInput>(
      event.payload.resultArtifactHash as string,
    );
    if (
      result.obligationId !== event.payload.obligationId ||
      result.snapshotHash !== event.payload.snapshotHash ||
      result.baseline.projectId !== state.baseline.projectId ||
      result.baseline.policyHash !== state.baseline.policyHash ||
      result.baseline.delegationHash !== state.baseline.delegationHash
    )
      continue;
    const receipt = result.receipts.find((item) => item.stage === "normalization_apply");
    if (!receipt) continue;
    const proof = await load<{
      obligationId: string;
      stage: string;
      resultSnapshotHash: string;
      delegationHash: string;
      approvedEffects: ConvergenceApprovedEffect[];
      proof: {
        receipt?: { operation: string; updated: string[]; created: string[] };
        review?: { reviewerAgentId: string };
        verification?: string[];
      };
    }>(receipt.artifactHash);
    const effect = proof.approvedEffects.find(
      (item) => item.path === path && item.afterHash === current,
    );
    if (!effect) continue;
    const assignment = result.stageData.settledAssignment as
      { agentId: string; assignmentId: string; status: string } | undefined;
    if (
      proof.obligationId !== result.obligationId ||
      proof.stage !== "normalization_apply" ||
      proof.resultSnapshotHash !== result.snapshotHash ||
      proof.delegationHash !== state.baseline.delegationHash ||
      !assignment ||
      assignment.status !== "completed" ||
      assignment.assignmentId !== event.payload.assignmentId ||
      !proof.proof.review?.reviewerAgentId ||
      proof.proof.review.reviewerAgentId === assignment.agentId ||
      proof.proof.receipt?.operation !== "normalize_documents" ||
      !proof.proof.receipt.updated.includes(path) ||
      !proof.proof.verification?.length ||
      effect.beforeHash === null
    )
      return false;
    current = effect.beforeHash;
    if (current === targetHash) return true;
    if (++steps >= 16) return false;
  }
  return false;
}
