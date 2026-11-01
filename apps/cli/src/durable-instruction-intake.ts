import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage } from "@lervo/project-storage";
import {
  applyDurableInstructionPlan,
  canonicalJson,
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  loadDurableInstructionCandidate,
  loadRepositoryKnowledgePolicy,
  removeDurableInstructionCandidate,
  sha256,
  storeDurableInstructionCandidate,
  type DurableInstructionCandidateInspection,
  type DurableInstructionPlan,
} from "@lervo/repository-knowledge";

import {
  commitAppliedInstructionCandidate,
  instructionCandidateApplyAuthority,
  recordInstructionCandidateResolution,
} from "@lervo/repository-knowledge-runtime";

import { groundDurableInstructionRequest } from "./durable-instruction-grounding.js";
import { inspectInstructionCatalog } from "./instruction-catalog.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliServices } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

const REVIEWER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{1,63}$/u;

function catalogDigest(catalog: Awaited<ReturnType<typeof inspectInstructionCatalog>>): string {
  return durableInstructionCatalogDigest(catalog.semanticCatalog.canonicalInstructions.entries);
}

export interface DurableInstructionIntakeResult {
  schemaVersion: 1;
  status: DurableInstructionPlan["status"] | "review_required";
  planId: string;
  reasonIds: string[];
  candidate: DurableInstructionCandidateInspection | null;
}

export async function intakeDurableInstruction(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  request: string;
  now: Date;
  services: Pick<CliServices, "groundProductionRequest">;
}): Promise<DurableInstructionIntakeResult> {
  const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
  const catalog = await inspectInstructionCatalog({
    repositoryRoot: input.repositoryRoot,
    supplementalSources,
  });
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    const currentWorkstream = await verifiedCurrentWorkstream(storage);
    const grounding = await groundDurableInstructionRequest({
      request: input.request,
      provider: input.provider,
      currentWorkstream:
        currentWorkstream === null
          ? null
          : {
              workstreamId: currentWorkstream.workstreamId,
              revision: currentWorkstream.revision,
            },
      semanticCatalog: catalog.semanticCatalog,
      services: input.services,
    });
    const plan = await createDurableInstructionPlan({
      repositoryRoot: input.repositoryRoot,
      projectId: storage.manifest.projectId,
      requestDigest: sha256(input.request),
      resolverResultDigest: grounding.resolverResultDigest,
      groundingStatus: grounding.status,
      catalogComplete:
        catalog.complete && catalog.semanticCatalog.canonicalInstructions.entries.length < 32,
      ambiguityReasons: grounding.ambiguityReasons,
      instruction: grounding.durableInstruction,
    });
    if (plan.status !== "ready") {
      return {
        schemaVersion: 1,
        status: plan.status,
        planId: plan.planId,
        reasonIds: plan.reasonIds,
        candidate: null,
      };
    }
    const candidate = await storeDurableInstructionCandidate({
      repositoryRoot: input.repositoryRoot,
      candidate: createDurableInstructionCandidate({
        plan,
        provider: input.provider,
        sourceSnapshotId: catalog.sourceSnapshotId,
        instruction: grounding.durableInstruction,
        now: input.now,
        instructionCatalogDigest: catalogDigest(catalog),
      }),
    });
    return {
      schemaVersion: 1,
      status: "review_required",
      planId: plan.planId,
      reasonIds: plan.reasonIds,
      candidate,
    };
  } finally {
    await storage.close();
  }
}

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
      await removeDurableInstructionCandidate({
        repositoryRoot: input.repositoryRoot,
        candidateId: candidate.candidateId,
        expectedCandidateHash: candidate.candidateHash,
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
        commitHash: null,
      };
    }
    const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
    const catalog = await inspectInstructionCatalog({
      repositoryRoot: input.repositoryRoot,
      supplementalSources,
    });
    // A captured candidate is reviewed later, after unrelated sources and events have changed the
    // snapshot; it binds to the instruction catalog it was judged against instead.
    const catalogUnchanged =
      catalog.sourceSnapshotId === candidate.sourceSnapshotId ||
      (candidate.instructionCatalogDigest !== undefined &&
        catalogDigest(catalog) === candidate.instructionCatalogDigest);
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
    await recordInstructionCandidateResolution({
      repositoryRoot: input.repositoryRoot,
      candidate: plainCandidate(candidate),
      resolution: "applied",
      resolvedAt: input.now,
    });
    // A Hub-coordinated owner commits the rule so publication and the replica reach every host.
    const commitHash =
      authority.status === "owner"
        ? await commitAppliedInstructionCandidate({
            repositoryRoot: input.repositoryRoot,
            targetPath: candidate.targetPath,
            candidateId: candidate.candidateId,
          })
        : null;
    await removeDurableInstructionCandidate({
      repositoryRoot: input.repositoryRoot,
      candidateId: candidate.candidateId,
      expectedCandidateHash: candidate.candidateHash,
    });
    return { ...receipt, commitHash };
  } finally {
    await storage.close();
  }
}
