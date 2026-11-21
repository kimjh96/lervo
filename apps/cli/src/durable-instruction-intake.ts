import { openProjectStorage } from "@lervo/project-storage";
import {
  createDurableInstructionCandidate,
  createDurableInstructionPlan,
  durableInstructionCatalogDigest,
  durableInstructionIsOwnerWording,
  sha256,
  storeDurableInstructionCandidate,
  type DurableInstructionCandidateInspection,
  type GroundedDurableInstruction,
} from "@lervo/repository-knowledge";
import {
  requestKnowledgeResidentCycle,
  enqueueInstructionCapture,
  instructionCandidateApplyAuthority,
} from "@lervo/repository-knowledge-runtime";

import { applyDurableInstructionCandidate } from "./durable-instruction-apply.js";
import { groundDurableInstructionRequest } from "./durable-instruction-grounding.js";
import { inspectInstructionCatalog } from "./instruction-catalog.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";
import type { CliServices } from "./types.js";
import { verifiedCurrentWorkstream } from "./workstream-services.js";

export function catalogDigest(
  catalog: Awaited<ReturnType<typeof inspectInstructionCatalog>>,
): string {
  return durableInstructionCatalogDigest(catalog.semanticCatalog.canonicalInstructions.entries);
}

/**
 * ADR-0561 intake outcomes. `applied` and `current`: the rule is in place. `stored`: the rule is
 * stored and the resident (or the Hub convergence owner) applies it. `queued`: grounding or the
 * fidelity check could not finish, so the owner's words wait in the private capture queue and are
 * retried in the background until stored. `ignored` and `workstream`: the request states no
 * repository-long rule. `not_stored`: the background queue refused the request.
 */
export interface DurableInstructionIntakeResult {
  schemaVersion: 1;
  status: "applied" | "current" | "stored" | "queued" | "ignored" | "workstream" | "not_stored";
  planId: string | null;
  reasonIds: string[];
  ruleId: string | null;
  targetPath: string | null;
  replacedPaths: string[];
  /** How the stored text was shown to match the owner's words. */
  fidelity: "owner_wording" | "cross_checked" | null;
  commitHash: string | null;
  captureId: string | null;
  candidate: DurableInstructionCandidateInspection | null;
}

type IntakeServices = Pick<CliServices, "groundProductionRequest" | "crossCheckDurableInstruction">;

const EMPTY = {
  schemaVersion: 1 as const,
  planId: null,
  ruleId: null,
  targetPath: null,
  replacedPaths: [],
  fidelity: null,
  commitHash: null,
  captureId: null,
  candidate: null,
};

/** Keeps the owner's words for the background capture path, which retries until it stores them. */
async function queueForBackground(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  request: string;
  now: Date;
  reasonIds: string[];
}): Promise<DurableInstructionIntakeResult> {
  const queued = await enqueueInstructionCapture({
    repositoryRoot: input.repositoryRoot,
    source: "terminal_prompt",
    provider: input.provider,
    ownerTurn: input.request,
    precedingAgentTurn: null,
    retained: true,
    now: input.now,
  });
  // ADR-0606: the queue appends no event, so the resident is asked to look at it.
  if (queued.status !== "skipped") await requestKnowledgeResidentCycle(input.repositoryRoot);
  return queued.status === "skipped"
    ? { ...EMPTY, status: "not_stored", reasonIds: [...input.reasonIds, queued.reason] }
    : { ...EMPTY, status: "queued", reasonIds: input.reasonIds, captureId: queued.captureId };
}

/** Owner wording needs no model check; a restatement needs an independent agreeing check. */
async function checkFidelity(input: {
  provider: "codex" | "claude";
  request: string;
  instruction: GroundedDurableInstruction;
  services: IntakeServices;
}): Promise<{ fidelity: "owner_wording" | "cross_checked" } | { reasonId: string }> {
  if (
    durableInstructionIsOwnerWording({ ownerText: input.request, instruction: input.instruction })
  )
    return { fidelity: "owner_wording" };
  try {
    const verdict = await input.services.crossCheckDurableInstruction({
      provider: input.provider,
      ownerText: input.request,
      instruction: input.instruction,
    });
    return verdict.verdict === "agree"
      ? { fidelity: "cross_checked" }
      : { reasonId: "cross_check_disagreed" };
  } catch {
    return { reasonId: "cross_check_unavailable" };
  }
}

/**
 * ADR-0561: an explicit owner rule is always stored and applied. Its risk, operation, conflict,
 * confidence, and scope are classification only; the one check is that the stored text matches
 * what the owner said. Nothing returns to the owner for review.
 */
export async function intakeDurableInstruction(input: {
  repositoryRoot: string;
  provider: "codex" | "claude";
  request: string;
  now: Date;
  services: IntakeServices;
}): Promise<DurableInstructionIntakeResult> {
  const supplementalSources = await collectLocalKnowledgeSources(input.repositoryRoot);
  const catalog = await inspectInstructionCatalog({
    repositoryRoot: input.repositoryRoot,
    supplementalSources,
  });
  const storage = await openProjectStorage(input.repositoryRoot);
  let candidate: DurableInstructionCandidateInspection;
  let stored: DurableInstructionIntakeResult;
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
    const background = (reasonIds: string[]) =>
      queueForBackground({ ...input, reasonIds: [...new Set(reasonIds)].sort() });
    if (grounding.failed) return await background(grounding.durableInstruction.reasonIds);
    let plan: Awaited<ReturnType<typeof createDurableInstructionPlan>>;
    try {
      plan = await createDurableInstructionPlan({
        repositoryRoot: input.repositoryRoot,
        projectId: storage.manifest.projectId,
        requestDigest: sha256(input.request),
        resolverResultDigest: grounding.resolverResultDigest,
        instruction: grounding.durableInstruction,
      });
    } catch (error) {
      // Unusable rule text is retried in the background instead of dropping the owner's rule.
      if (!(error instanceof TypeError)) throw error;
      return await background([...grounding.durableInstruction.reasonIds, "rule_text_invalid"]);
    }
    if (plan.status === "ignored" || plan.status === "workstream")
      return { ...EMPTY, status: plan.status, planId: plan.planId, reasonIds: plan.reasonIds };
    if (plan.status === "ungrounded") return await background(plan.reasonIds);
    const fidelity = await checkFidelity({
      provider: input.provider,
      request: input.request,
      instruction: grounding.durableInstruction,
      services: input.services,
    });
    if ("reasonId" in fidelity) return await background([...plan.reasonIds, fidelity.reasonId]);
    stored = {
      ...EMPTY,
      status: "stored",
      planId: plan.planId,
      reasonIds: plan.reasonIds,
      ruleId: plan.ruleId,
      targetPath: plan.targetPath,
      replacedPaths: plan.replacedPaths,
      fidelity: fidelity.fidelity,
    };
    if (plan.status === "current") return { ...stored, status: "current" };
    candidate = await storeDurableInstructionCandidate({
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
  } finally {
    await storage.close();
  }
  // ADR-0606: a stored candidate the command cannot apply here waits for the resident.
  await requestKnowledgeResidentCycle(input.repositoryRoot);
  if ((await instructionCandidateApplyAuthority(input.repositoryRoot)).status !== "owner_elsewhere")
    try {
      const applied = await applyDurableInstructionCandidate({
        repositoryRoot: input.repositoryRoot,
        candidateId: candidate.candidateId,
        now: input.now,
      });
      return {
        ...stored,
        status: applied.status,
        planId: applied.planId,
        replacedPaths: applied.replacedPaths,
        commitHash: applied.commitHash,
      };
    } catch {
      // The stored candidate stays; the resident's next cycle applies it.
      return { ...stored, candidate, reasonIds: [...stored.reasonIds, "apply_deferred"] };
    }
  return { ...stored, candidate };
}
