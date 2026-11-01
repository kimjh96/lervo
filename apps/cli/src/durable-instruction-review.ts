import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyDurableInstructionPlan,
  canonicalJson,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  loadDurableInstructionCandidate,
  loadRepositoryKnowledgePolicy,
  removeDurableInstructionCandidate,
  sha256,
  type DurableInstructionCandidateInspection,
} from "@lervo/repository-knowledge";
import {
  appliedInstructionCandidateCommitted,
  commitAppliedInstructionCandidate,
  instructionCandidateApplyAuthority,
  recordInstructionCandidateResolution,
  type InstructionCandidateApplyAuthority,
} from "@lervo/repository-knowledge-runtime";

import { catalogReachedThroughOwnerRuleApplies } from "./durable-instruction-catalog-chain.js";
import { catalogDigest } from "./durable-instruction-intake.js";
import { inspectInstructionCatalog } from "./instruction-catalog.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";

const REVIEWER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u;

function plainCandidate(candidate: DurableInstructionCandidateInspection) {
  const { candidateHash: _hash, artifactPath: _path, ...plain } = candidate;
  return plain;
}

/**
 * ADR-0467: on a Hub-coordinated host only the ADR-0466 convergence owner applies, because it is
 * the host that commits knowledge outputs; review on another host names the owner instead.
 */
export class InstructionApplyOwnerElsewhereError extends Error {
  readonly code = "convergence_owner_elsewhere";

  constructor(
    readonly reason: string,
    readonly holderLabel: string | null,
  ) {
    super(
      `This host does not own knowledge convergence (${reason}). The convergence owner host${holderLabel === null ? "" : ` (${holderLabel})`} receives this candidate through the Hub exchange and applies an owner-stated rule automatically; no review is needed here.`,
    );
    this.name = "InstructionApplyOwnerElsewhereError";
  }
}

function assertReview(input: {
  candidate: DurableInstructionCandidateInspection;
  candidateHash: string;
  reviewerId: string;
}): void {
  if (!REVIEWER_ID.test(input.reviewerId)) throw new Error("The reviewer ID is invalid.");
  if (input.candidate.candidateHash !== input.candidateHash)
    throw new Error("The reviewed candidate hash does not match current candidate bytes.");
}

export async function rejectDurableInstructionCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  candidateHash: string;
  reviewerId: string;
}): Promise<{ schemaVersion: 1; status: "rejected"; candidateId: string; reviewDigest: string }> {
  const candidate = await loadDurableInstructionCandidate(input);
  assertReview({ candidate, candidateHash: input.candidateHash, reviewerId: input.reviewerId });
  await recordInstructionCandidateResolution({
    repositoryRoot: input.repositoryRoot,
    candidate: plainCandidate(candidate),
    resolution: "rejected",
    resolvedAt: new Date(),
  });
  await removeDurableInstructionCandidate({
    repositoryRoot: input.repositoryRoot,
    candidateId: input.candidateId,
    expectedCandidateHash: input.candidateHash,
  });
  return {
    schemaVersion: 1,
    status: "rejected",
    candidateId: input.candidateId,
    reviewDigest: sha256(
      canonicalJson({
        candidateId: input.candidateId,
        candidateHash: input.candidateHash,
        reviewerId: input.reviewerId,
        decision: "reject",
      }),
    ),
  };
}

/** A Hub owner applied the rule file but could not commit it yet; the candidate stays for retry. */
export class InstructionCommitPendingError extends Error {
  readonly code = "knowledge_output_commit_pending";

  constructor() {
    super("The applied owner rule is not committed yet; the candidate stays for the next attempt.");
    this.name = "InstructionCommitPendingError";
  }
}

/**
 * ADR-0545: a Hub owner settles a candidate only once its rule commit exists, so other hosts never
 * drop a candidate whose rule cannot reach them through Git. A retry reuses an earlier commit.
 */
async function settleAppliedCandidate(input: {
  repositoryRoot: string;
  candidate: DurableInstructionCandidateInspection;
  authority: InstructionCandidateApplyAuthority;
  now: Date;
}): Promise<string | null> {
  let commitHash: string | null = null;
  if (input.authority.status === "owner") {
    commitHash = await commitAppliedInstructionCandidate({
      repositoryRoot: input.repositoryRoot,
      targetPath: input.candidate.targetPath,
      candidateId: input.candidate.candidateId,
    });
    if (
      commitHash === null &&
      !(await appliedInstructionCandidateCommitted({
        repositoryRoot: input.repositoryRoot,
        targetPath: input.candidate.targetPath,
      }))
    )
      throw new InstructionCommitPendingError();
  }
  await recordInstructionCandidateResolution({
    repositoryRoot: input.repositoryRoot,
    candidate: plainCandidate(input.candidate),
    resolution: "applied",
    resolvedAt: input.now,
  });
  await removeDurableInstructionCandidate({
    repositoryRoot: input.repositoryRoot,
    candidateId: input.candidate.candidateId,
    expectedCandidateHash: input.candidate.candidateHash,
  });
  return commitHash;
}

export async function applyReviewedDurableInstruction(input: {
  repositoryRoot: string;
  candidateId: string;
  candidateHash: string;
  reviewerId: string;
  now: Date;
}) {
  const candidate = await loadDurableInstructionCandidate(input);
  assertReview({ candidate, candidateHash: input.candidateHash, reviewerId: input.reviewerId });
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  if (authority.status === "owner_elsewhere")
    throw new InstructionApplyOwnerElsewhereError(authority.reason, authority.holderLabel);
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (storage.manifest.projectId !== candidate.projectId)
      throw new Error("The durable-instruction candidate belongs to another project.");
    const reviewDigest = sha256(
      canonicalJson({
        candidateId: candidate.candidateId,
        candidateHash: candidate.candidateHash,
        reviewerId: input.reviewerId,
        decision: "apply",
      }),
    );
    const appliedEvent = storage.events
      .list()
      .find(
        (event) =>
          event.type === "knowledge.materialization.applied" &&
          event.payload.planId === candidate.planId,
      );
    if (appliedEvent !== undefined) {
      const target = await readFile(resolve(input.repositoryRoot, candidate.targetPath), "utf8");
      if (
        sha256(target) !== candidate.proposedContentHash ||
        appliedEvent.payload.approvalDigest !== reviewDigest
      )
        throw new Error("The prior durable-instruction apply result conflicts with this review.");
      const commitHash = await settleAppliedCandidate({
        repositoryRoot: input.repositoryRoot,
        candidate,
        authority,
        now: input.now,
      });
      return {
        schemaVersion: 1 as const,
        type: "knowledge.materialization.applied" as const,
        operation: "durable_instruction_intake" as const,
        planId: candidate.planId,
        projectId: candidate.projectId,
        sourceSnapshotId: candidate.sourceSnapshotId,
        ruleId: candidate.ruleId,
        targetPath: candidate.targetPath,
        approvalDigest: reviewDigest,
        appliedAt: appliedEvent.occurredAt,
        commitHash,
      };
    }
    const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
    const catalog = await inspectInstructionCatalog({
      repositoryRoot: input.repositoryRoot,
      supplementalSources,
    });
    // A captured candidate is reviewed later, after unrelated sources and events have changed the
    // snapshot; it binds to the instruction catalog it was judged against instead.
    // ADR-0545: owner rules applied after this candidate was judged do not invalidate it; the
    // recorded before/after digests of those applies prove that nothing else changed.
    const currentCatalogDigest = catalogDigest(catalog);
    const catalogUnchanged =
      catalog.sourceSnapshotId === candidate.sourceSnapshotId ||
      (candidate.instructionCatalogDigest !== undefined &&
        (currentCatalogDigest === candidate.instructionCatalogDigest ||
          catalogReachedThroughOwnerRuleApplies({
            events: storage.events.list(),
            from: candidate.instructionCatalogDigest,
            to: currentCatalogDigest,
          })));
    if (
      !catalog.complete ||
      catalog.semanticCatalog.canonicalInstructions.entries.length >= 32 ||
      !catalogUnchanged
    )
      throw new Error("The canonical instruction catalog changed after candidate review began.");
    const plan = await createDurableInstructionPlan({
      repositoryRoot: input.repositoryRoot,
      projectId: candidate.projectId,
      requestDigest: candidate.requestDigest,
      resolverResultDigest: candidate.resolverResultDigest,
      groundingStatus: "ready",
      catalogComplete: true,
      ambiguityReasons: [],
      instruction: candidate.instruction,
    });
    if (
      plan.status !== "ready" ||
      plan.planId !== candidate.planId ||
      plan.ruleId !== candidate.ruleId ||
      plan.targetPath !== candidate.targetPath ||
      plan.operations[0]?.desiredHash !== candidate.proposedContentHash ||
      plan.operations[0]?.content !== candidate.proposedMarkdown
    )
      throw new Error("The durable-instruction materialization plan is stale.");
    const policy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
    const policyHash = sha256(canonicalJson(policy));
    const identity = randomUUID().replaceAll("-", "");
    const beforeRegistryDigest = catalogDigest(catalog);
    const receipt = {
      schemaVersion: 1 as const,
      type: "knowledge.materialization.applied" as const,
      operation: "durable_instruction_intake" as const,
      planId: plan.planId,
      projectId: candidate.projectId,
      sourceSnapshotId: candidate.sourceSnapshotId,
      ruleId: candidate.ruleId,
      targetPath: candidate.targetPath,
      approvalDigest: reviewDigest,
      appliedAt: input.now.toISOString(),
    };
    await applyDurableInstructionPlan({
      plan,
      receipt,
      recordApplied: (applied) => {
        const afterRegistryDigest = durableInstructionCatalogDigest([
          ...catalog.semanticCatalog.canonicalInstructions.entries,
          { path: candidate.targetPath, contentHash: candidate.proposedContentHash },
        ]);
        storage.events.append({
          eventId: `evt_${identity}`,
          projectId: candidate.projectId,
          runId: `run_${identity}`,
          sessionId: `ses_${identity}`,
          type: "knowledge.materialization.applied",
          occurredAt: applied.appliedAt,
          actor: { kind: "system" },
          schemaVersion: 1,
          policyVersion: policyHash,
          payload: {
            operation: applied.operation,
            planId: applied.planId,
            sourceSnapshotId: applied.sourceSnapshotId,
            policyHash,
            compilerId: "lervo.durable-instruction",
            compilerVersion: "1",
            approvalDigest: applied.approvalDigest,
            coverage: "full",
            bundleIds: [],
            createdConceptIds: [],
            updatedConceptIds: [],
            deprecatedConceptIds: [],
            conceptListTruncated: false,
            resultArtifactId: null,
            resultArtifactHash: null,
            createdCount: 1,
            updatedCount: 0,
            unchangedCount: 0,
            beforeRegistryDigest,
            afterRegistryDigest,
            validationReportId: null,
            validationReportHash: null,
            appliedAt: applied.appliedAt,
          },
        });
      },
    });
    // A Hub-coordinated owner commits the rule so publication and the replica reach every host.
    const commitHash = await settleAppliedCandidate({
      repositoryRoot: input.repositoryRoot,
      candidate,
      authority,
      now: input.now,
    });
    return { ...receipt, commitHash };
  } finally {
    await storage.close();
  }
}
