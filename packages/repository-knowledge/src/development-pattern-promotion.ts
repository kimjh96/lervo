import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import {
  type DevelopmentPatternCandidate,
  type DevelopmentPatternReview,
} from "./development-pattern-candidate.js";
import { authorizeCurrentRepositoryDocumentLayout } from "./document-layout-enforcement.js";
import { sha256, stableId } from "./integrity.js";
import {
  assertExactPassedWorkflowVerification,
  type PassedWorkflowVerificationEvidence,
} from "./portable-skill-pattern.js";
import type { KnowledgeFileOperation, RepositoryKnowledgeScan } from "./types.js";

export interface DevelopmentPatternPromotionPlan {
  schemaVersion: 1;
  planKind: "development_pattern_promotion";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  patternId: string;
  candidateContentHash: string;
  reviewContentHash: string;
  sourceSnapshotId: string;
  sourceFreshness: "current" | "stale";
  status: "ready" | "current" | "blocked";
  blockers: string[];
  agentRoutes: Array<{ provider: "codex" | "claude"; path: string; disposition: string }>;
  verificationCommands: string[];
  operations: KnowledgeFileOperation[];
}

async function readBoundedText(
  repositoryRoot: string,
  path: string,
  maximumBytes: number,
): Promise<{ content: string; contentHash: string } | null> {
  try {
    const content = await readFile(resolve(repositoryRoot, path), "utf8");
    if (Buffer.byteLength(content) > maximumBytes)
      throw new Error("Development-pattern target exceeds the bounded read limit.");
    return { content, contentHash: sha256(content) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

function mediaType(path: string): KnowledgeFileOperation["mediaType"] {
  if (path.endsWith(".md")) return "text/markdown";
  if (path.endsWith(".json")) return "application/json";
  if (path.endsWith(".yaml") || path.endsWith(".yml")) return "application/yaml";
  return "text/javascript";
}

function desiredTargets(candidate: DevelopmentPatternCandidate): Array<{
  path: string;
  content: string;
  reason: string;
}> {
  const primary = {
    path: candidate.target.path,
    content: candidate.target.content,
    reason: `promoted_pattern_${candidate.target.kind}`,
  };
  if (candidate.portableSkillPackage === undefined) return [primary];
  const directory = candidate.target.path.slice(0, -"/SKILL.md".length);
  return [
    primary,
    ...candidate.portableSkillPackage.resources.map((resource) => ({
      path: `${directory}/${resource.path}`,
      content: resource.content,
      reason: "promoted_pattern_portable_skill_resource",
    })),
    {
      path: `${directory}/lervo-skill.json`,
      content: candidate.portableSkillPackage.manifestContent,
      reason: "promoted_pattern_portable_skill_contract",
    },
  ];
}

async function targetOperations(input: {
  repositoryRoot: string;
  candidate: DevelopmentPatternCandidate;
  blockers: string[];
}): Promise<KnowledgeFileOperation[]> {
  const operations: KnowledgeFileOperation[] = [];
  for (const target of desiredTargets(input.candidate)) {
    const current = await readBoundedText(input.repositoryRoot, target.path, 128 * 1024);
    const desiredHash = sha256(target.content);
    if (current !== null && current.contentHash !== desiredHash)
      input.blockers.push("target_conflict");
    operations.push({
      path: target.path,
      action: current === null ? "create" : "unchanged",
      ownership: "lervo_generated",
      mediaType: mediaType(target.path),
      ...(current === null ? { content: target.content } : {}),
      ...(current === null ? {} : { expectedCurrentHash: current.contentHash }),
      desiredHash,
      reason: target.reason,
    });
  }
  return operations;
}

export async function createDevelopmentPatternPromotionPlan(input: {
  repositoryRoot: string;
  projectId: string;
  candidate: DevelopmentPatternCandidate;
  candidateContentHash: string;
  review: DevelopmentPatternReview;
  reviewContentHash: string;
  currentScan: RepositoryKnowledgeScan;
  passedVerificationEvidence?: readonly PassedWorkflowVerificationEvidence[];
}): Promise<DevelopmentPatternPromotionPlan> {
  const blockers: string[] = [];
  if (input.review.decision !== "accept") blockers.push("pattern_not_accepted");
  if (input.review.candidateContentHash !== input.candidateContentHash)
    blockers.push("review_candidate_mismatch");
  if (input.candidate.workflowVerification !== undefined) {
    try {
      assertExactPassedWorkflowVerification(
        input.candidate.workflowVerification,
        input.passedVerificationEvidence ?? [],
      );
    } catch {
      blockers.push("verification_evidence_changed");
    }
  }
  const sourceFreshness =
    input.currentScan.contentSnapshotId === input.candidate.sourceSnapshotId ? "current" : "stale";
  const operations = await targetOperations({
    repositoryRoot: input.repositoryRoot,
    candidate: input.candidate,
    blockers,
  });
  const changed = operations.some((item) => item.action !== "unchanged");
  if (sourceFreshness === "stale" && changed) blockers.push("source_snapshot_changed");
  const uniqueBlockers = [...new Set(blockers)].sort();
  const planId = stableId("kpatternplan", {
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    reviewContentHash: input.reviewContentHash,
    blockers: uniqueBlockers,
    operations,
  });
  if (uniqueBlockers.length === 0)
    await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: input.repositoryRoot,
      operations,
    });
  return {
    schemaVersion: 1,
    planKind: "development_pattern_promotion",
    planId,
    repositoryRoot: resolve(input.repositoryRoot),
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    reviewContentHash: input.reviewContentHash,
    sourceSnapshotId: input.candidate.sourceSnapshotId,
    sourceFreshness,
    status: uniqueBlockers.length > 0 ? "blocked" : changed ? "ready" : "current",
    blockers: uniqueBlockers,
    agentRoutes:
      input.candidate.target.kind === "automated_check"
        ? []
        : [
            {
              provider: "codex",
              path: input.candidate.target.path,
              disposition: "knowledge_registry_route",
            },
            {
              provider: "claude",
              path: input.candidate.target.path,
              disposition: "knowledge_registry_route",
            },
          ],
    verificationCommands: input.candidate.verificationCommands,
    operations,
  };
}

export function publicDevelopmentPatternPromotionPlan(plan: DevelopmentPatternPromotionPlan) {
  return {
    ...plan,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function applyDevelopmentPatternPromotion<T>(input: {
  plan: DevelopmentPatternPromotionPlan;
  approval: string;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
}): Promise<T> {
  if (input.plan.status === "blocked") throw new Error("Development-pattern promotion is blocked.");
  if (input.approval !== input.plan.planId)
    throw new Error("Approval must equal the exact development-pattern promotion plan ID.");
  return applyDurableKnowledgeOperations({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    planId: input.plan.planId,
    operations: input.plan.operations,
    documentLayoutPermit: await authorizeCurrentRepositoryDocumentLayout({
      repositoryRoot: input.plan.repositoryRoot,
      operations: input.plan.operations,
    }),
    receipt: input.receipt,
    recordApplied: input.recordApplied,
  });
}
