import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";

import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
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
  type DurableInstructionPlan,
} from "@lervo/repository-knowledge";
import {
  appliedInstructionCandidateCommitted,
  commitAppliedInstructionCandidate,
  instructionCandidateApplyAuthority,
  recordInstructionCandidateResolution,
  type InstructionCandidateApplyAuthority,
} from "@lervo/repository-knowledge-runtime";

import { inspectInstructionCatalog } from "./instruction-catalog.js";
import { collectLocalKnowledgeSources } from "./knowledge-sources.js";

/** The settling identity recorded for every rule Lervo applies; no person reviews it (ADR-0561). */
export const LERVO_INSTRUCTION_SETTLER = "lervo";

function plainCandidate(candidate: DurableInstructionCandidateInspection) {
  const { candidateHash: _hash, artifactPath: _path, ...plain } = candidate;
  return plain;
}

/**
 * ADR-0467: on a Hub-coordinated host only the ADR-0466 convergence owner applies, because it is
 * the host that commits knowledge outputs. Another host keeps the candidate for the Hub exchange.
 */
export class InstructionApplyOwnerElsewhereError extends Error {
  readonly code = "convergence_owner_elsewhere";

  constructor(
    readonly reason: string,
    readonly holderLabel: string | null,
  ) {
    super(
      `This host does not own knowledge convergence (${reason}). The convergence owner host${holderLabel === null ? "" : ` (${holderLabel})`} receives this rule through the Hub exchange and applies it automatically.`,
    );
    this.name = "InstructionApplyOwnerElsewhereError";
  }
}

/** A Hub owner applied the rule file but could not commit it yet; the candidate stays for retry. */
export class InstructionCommitPendingError extends Error {
  readonly code = "knowledge_output_commit_pending";

  constructor() {
    super("The applied owner rule is not committed yet; the candidate stays for the next attempt.");
    this.name = "InstructionCommitPendingError";
  }
}

export interface AppliedDurableInstruction {
  schemaVersion: 1;
  status: "applied" | "current";
  candidateId: string;
  planId: string;
  ruleId: string;
  targetPath: string;
  replacedPaths: string[];
  appliedAt: string;
  commitHash: string | null;
}

/**
 * ADR-0545: a Hub owner settles a candidate only once its rule commit exists, so other hosts never
 * drop a candidate whose rule cannot reach them through Git. A retry reuses an earlier commit.
 */
async function settleAppliedCandidate(input: {
  repositoryRoot: string;
  candidate: DurableInstructionCandidateInspection;
  replacedPaths: readonly string[];
  authority: InstructionCandidateApplyAuthority;
  now: Date;
}): Promise<string | null> {
  let commitHash: string | null = null;
  if (input.authority.status === "owner") {
    commitHash = await commitAppliedInstructionCandidate({
      repositoryRoot: input.repositoryRoot,
      targetPath: input.candidate.targetPath,
      replacedPaths: input.replacedPaths,
      candidateId: input.candidate.candidateId,
    });
    if (
      commitHash === null &&
      !(await appliedInstructionCandidateCommitted({
        repositoryRoot: input.repositoryRoot,
        targetPath: input.candidate.targetPath,
        replacedPaths: input.replacedPaths,
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

const GENERATED_RULE_PATH = /^docs\/instructions\/generated\/rule_[a-f0-9]{24}\.md$/u;

/** Generated rules the candidate replaced that a prior apply already deleted. */
async function deletedReplacements(
  root: string,
  candidate: DurableInstructionCandidateInspection,
): Promise<string[]> {
  const deleted: string[] = [];
  for (const path of candidate.instruction.replaces ?? []) {
    if (!GENERATED_RULE_PATH.test(path) || path === candidate.targetPath) continue;
    const present = await access(resolve(root, path)).then(
      () => true,
      () => false,
    );
    if (!present) deleted.push(path);
  }
  return deleted;
}

function recordAppliedEvent(input: {
  storage: ProjectStorage;
  plan: DurableInstructionPlan;
  candidate: DurableInstructionCandidateInspection;
  applyDigest: string;
  policyHash: string;
  beforeRegistryDigest: string;
  afterRegistryDigest: string;
  appliedAt: string;
}): void {
  const identity = randomUUID().replaceAll("-", "");
  const ruleAction = input.plan.operations[0]?.action;
  input.storage.events.append({
    eventId: `evt_${identity}`,
    projectId: input.candidate.projectId,
    runId: `run_${identity}`,
    sessionId: `ses_${identity}`,
    type: "knowledge.materialization.applied",
    occurredAt: input.appliedAt,
    actor: { kind: "system" },
    schemaVersion: 1,
    policyVersion: input.policyHash,
    payload: {
      operation: "durable_instruction_intake",
      planId: input.plan.planId,
      sourceSnapshotId: input.candidate.sourceSnapshotId,
      policyHash: input.policyHash,
      compilerId: "lervo.durable-instruction",
      compilerVersion: "2",
      approvalDigest: input.applyDigest,
      coverage: "full",
      bundleIds: [],
      createdConceptIds: [],
      updatedConceptIds: [],
      deprecatedConceptIds: [],
      conceptListTruncated: false,
      resultArtifactId: null,
      resultArtifactHash: null,
      createdCount: ruleAction === "create" ? 1 : 0,
      updatedCount: ruleAction === "update" ? 1 : 0,
      unchangedCount: ruleAction === "unchanged" ? 1 : 0,
      deletedCount: input.plan.replacedPaths.length,
      beforeRegistryDigest: input.beforeRegistryDigest,
      afterRegistryDigest: input.afterRegistryDigest,
      validationReportId: null,
      validationReportHash: null,
      appliedAt: input.appliedAt,
    },
  });
}

/**
 * ADR-0561: applies one stored candidate without any owner review. Candidates are stored only
 * after their fidelity or cross-check passed, so applying needs no further judgment. The plan is
 * rebuilt against current bytes: a rule stored since then makes it `current`, and an older rule
 * it replaces is deleted in the same transaction. The commit or the generated file is the undo.
 */
export async function applyDurableInstructionCandidate(input: {
  repositoryRoot: string;
  candidateId: string;
  now: Date;
}): Promise<AppliedDurableInstruction> {
  const candidate = await loadDurableInstructionCandidate(input);
  const authority = await instructionCandidateApplyAuthority(input.repositoryRoot);
  if (authority.status === "owner_elsewhere")
    throw new InstructionApplyOwnerElsewhereError(authority.reason, authority.holderLabel);
  const storage = await openProjectStorage(input.repositoryRoot);
  try {
    if (storage.manifest.projectId !== candidate.projectId)
      throw new Error("The durable-instruction candidate belongs to another project.");
    const applyDigest = sha256(
      canonicalJson({
        candidateId: candidate.candidateId,
        candidateHash: candidate.candidateHash,
        settledBy: LERVO_INSTRUCTION_SETTLER,
        decision: "apply",
      }),
    );
    const result = (
      status: AppliedDurableInstruction["status"],
      planId: string,
      replacedPaths: string[],
      appliedAt: string,
      commitHash: string | null,
    ): AppliedDurableInstruction => ({
      schemaVersion: 1,
      status,
      candidateId: candidate.candidateId,
      planId,
      ruleId: candidate.ruleId,
      targetPath: candidate.targetPath,
      replacedPaths,
      appliedAt,
      commitHash,
    });
    const priorEvent = storage.events
      .list()
      .find(
        (event) =>
          event.type === "knowledge.materialization.applied" &&
          event.payload.approvalDigest === applyDigest,
      );
    const plan = await createDurableInstructionPlan({
      repositoryRoot: input.repositoryRoot,
      projectId: candidate.projectId,
      requestDigest: candidate.requestDigest,
      resolverResultDigest: candidate.resolverResultDigest,
      instruction: candidate.instruction,
    });
    if (plan.ruleId !== candidate.ruleId || plan.targetPath !== candidate.targetPath)
      throw new Error("The durable-instruction candidate no longer plans the same rule.");
    if (priorEvent !== undefined || plan.status === "current") {
      // A prior apply wrote the rule (and may not have committed it yet), or the same rule is
      // already stored: settle without writing again.
      const replacedPaths =
        priorEvent === undefined ? [] : await deletedReplacements(input.repositoryRoot, candidate);
      const commitHash = await settleAppliedCandidate({
        repositoryRoot: input.repositoryRoot,
        candidate,
        replacedPaths,
        authority,
        now: input.now,
      });
      return result(
        "current",
        plan.planId,
        replacedPaths,
        priorEvent?.occurredAt ?? input.now.toISOString(),
        commitHash,
      );
    }
    if (plan.status !== "ready")
      throw new Error("The durable-instruction materialization plan is stale.");
    const catalog = await inspectInstructionCatalog({
      repositoryRoot: input.repositoryRoot,
      supplementalSources: await collectLocalKnowledgeSources(input.repositoryRoot),
    });
    const entries = catalog.semanticCatalog.canonicalInstructions.entries;
    const policy = await loadRepositoryKnowledgePolicy(input.repositoryRoot);
    const policyHash = sha256(canonicalJson(policy));
    const appliedAt = input.now.toISOString();
    await applyDurableInstructionPlan({
      plan,
      receipt: null,
      recordApplied: () =>
        recordAppliedEvent({
          storage,
          plan,
          candidate,
          applyDigest,
          policyHash,
          beforeRegistryDigest: durableInstructionCatalogDigest(entries),
          afterRegistryDigest: durableInstructionCatalogDigest([
            ...entries.filter(
              (entry) =>
                entry.path !== candidate.targetPath && !plan.replacedPaths.includes(entry.path),
            ),
            { path: candidate.targetPath, contentHash: plan.operations[0]!.desiredHash },
          ]),
          appliedAt,
        }),
    });
    // A Hub-coordinated owner commits the rule so publication and the replica reach every host.
    const commitHash = await settleAppliedCandidate({
      repositoryRoot: input.repositoryRoot,
      candidate,
      replacedPaths: plan.replacedPaths,
      authority,
      now: input.now,
    });
    return result("applied", plan.planId, plan.replacedPaths, appliedAt, commitHash);
  } finally {
    await storage.close();
  }
}
