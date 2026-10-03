import { canonicalJson, sha256, type KnowledgeConvergenceInput } from "@lervo/repository-knowledge";
import type { OutboxStore, ArtifactStore } from "@lervo/storage-contract";
import type { CanonicalBatch } from "./canonical-review.js";
import type { SemanticReviewContextDocument } from "./review-context.js";
import type { CanonicalAssessmentSource } from "./canonical-assessment-contract.js";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

interface ApprovedBatch {
  eventId: string;
  assessment: CanonicalBatch["assessment"];
  generatorAgentId: string;
  sourceDigest: string;
  contextDigest: string;
  approval: {
    assessmentHash: string;
    decision: "approve";
    rationale: string;
    sourceHashes: string[];
    draftHashes: string[];
    reviewerAgentId: string;
    delegationHash: string;
    policyHash: string;
  };
  projectId: string;
}

const indexes = new WeakMap<OutboxStore, { afterSeq: number; batches: ApprovedBatch[] }>();

async function loadInput(
  artifacts: ArtifactStore,
  hash: string,
): Promise<KnowledgeConvergenceInput> {
  const bytes = await artifacts.get(`lervo-cas://sha256/${hash.slice(7)}`);
  if (sha256(bytes) !== hash)
    throw new KnowledgeConvergenceRuntimeError("knowledge_job_source_invalid");
  return JSON.parse(
    new TextDecoder("utf8", { fatal: true }).decode(bytes),
  ) as KnowledgeConvergenceInput;
}

/** Reuse only completed, draft-free integration with identical source and review context bytes. */
export async function findApprovedCanonicalBatch(input: {
  events: OutboxStore;
  artifacts: ArtifactStore;
  state: KnowledgeConvergenceInput;
  sources: CanonicalAssessmentSource[];
  context: SemanticReviewContextDocument[];
}): Promise<ApprovedBatch | null> {
  const index = indexes.get(input.events) ?? { afterSeq: 0, batches: [] };
  for (;;) {
    const page = input.events.list({ afterSeq: index.afterSeq, limit: 1_000 });
    if (!page.length) break;
    for (const event of page) {
      index.afterSeq = event.seq;
      if (
        event.type !== "repository.knowledge.stage.recorded" ||
        event.payload.stage !== "canonical_integration" ||
        event.payload.state !== "current" ||
        typeof event.payload.inputArtifactHash !== "string"
      )
        continue;
      const prior = await loadInput(input.artifacts, event.payload.inputArtifactHash);
      const batch = prior.stageData.canonicalBatch as CanonicalBatch | null;
      const approval = prior.stageData.canonicalApproval as ApprovedBatch["approval"] | null;
      if (
        prior.obligationId !== event.payload.obligationId ||
        prior.baseline.projectId !== event.projectId ||
        !batch ||
        !approval ||
        batch.assessment.drafts.length !== 0 ||
        batch.assessment.decisions.some((decision) => decision.disposition === "needs_review") ||
        approval.decision !== "approve" ||
        approval.assessmentHash !== sha256(canonicalJson(batch.assessment)) ||
        canonicalJson(approval.sourceHashes) !==
          canonicalJson(batch.sources.map((source) => source.contentHash)) ||
        canonicalJson(approval.draftHashes) !== canonicalJson([]) ||
        !approval.reviewerAgentId ||
        approval.reviewerAgentId === batch.generatorAgentId ||
        approval.delegationHash !== prior.baseline.delegationHash ||
        approval.policyHash !== prior.baseline.policyHash
      )
        continue;
      index.batches.push({
        eventId: event.eventId,
        assessment: batch.assessment,
        generatorAgentId: batch.generatorAgentId,
        sourceDigest: sha256(canonicalJson(batch.sources)),
        contextDigest: sha256(canonicalJson(batch.context)),
        approval,
        projectId: event.projectId,
      });
    }
  }
  indexes.set(input.events, index);
  const sourceDigest = sha256(canonicalJson(input.sources));
  const contextDigest = sha256(canonicalJson(input.context));
  return (
    index.batches.findLast(
      (item) =>
        item.projectId === input.state.baseline.projectId &&
        item.approval.delegationHash === input.state.baseline.delegationHash &&
        item.approval.policyHash === input.state.baseline.policyHash &&
        item.sourceDigest === sourceDigest &&
        item.contextDigest === contextDigest,
    ) ?? null
  );
}
