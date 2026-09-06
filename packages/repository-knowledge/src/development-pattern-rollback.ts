import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { applyDurableKnowledgeOperations } from "./durable-apply.js";
import type { DevelopmentPatternCandidate } from "./development-pattern-candidate.js";
import { sha256, stableId } from "./integrity.js";
import type { KnowledgeFileOperation } from "./types.js";

export interface DevelopmentPatternRollbackPlan {
  schemaVersion: 1;
  planKind: "development_pattern_rollback";
  planId: string;
  repositoryRoot: string;
  projectId: string;
  patternId: string;
  candidateContentHash: string;
  targetPath: string;
  targetContentHash: string;
  restoredContentHash: string | null;
  restoredContent: string | null;
  status: "ready" | "current" | "blocked";
  blockers: string[];
  operations: KnowledgeFileOperation[];
}

async function currentHash(repositoryRoot: string, path: string): Promise<string | null> {
  try {
    const bytes = await readFile(resolve(repositoryRoot, path));
    if (bytes.byteLength > 128 * 1024)
      throw new Error("The agent-profile rollback target exceeds its bounded limit.");
    return sha256(bytes);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function createDevelopmentPatternRollbackPlan(input: {
  repositoryRoot: string;
  projectId: string;
  patternState: string;
  candidate: DevelopmentPatternCandidate;
  candidateContentHash: string;
  previousTargetContentHash: string | null;
  previousTargetContent: string | null;
}): Promise<DevelopmentPatternRollbackPlan> {
  const blockers: string[] = [];
  if (input.candidate.target.kind !== "agent_profile") blockers.push("target_not_agent_profile");
  if (!["promoted", "rolled_back"].includes(input.patternState))
    blockers.push("pattern_not_promoted");
  if (
    (input.previousTargetContent === null) !== (input.previousTargetContentHash === null) ||
    (input.previousTargetContent !== null &&
      sha256(input.previousTargetContent) !== input.previousTargetContentHash)
  )
    blockers.push("rollback_artifact_changed");
  if (
    input.candidate.target.kind === "agent_profile" &&
    input.candidate.target.expectedCurrentHash !== input.previousTargetContentHash
  )
    blockers.push("rollback_predecessor_mismatch");

  const targetPath = input.candidate.target.path;
  const targetContentHash = sha256(input.candidate.target.content);
  const observedTargetHash = await currentHash(input.repositoryRoot, targetPath);
  const expectedHash =
    input.patternState === "rolled_back" ? input.previousTargetContentHash : targetContentHash;
  if (observedTargetHash !== expectedHash) blockers.push("target_changed");
  const uniqueBlockers = [...new Set(blockers)].sort();
  const alreadyCurrent =
    input.patternState === "rolled_back" &&
    observedTargetHash === input.previousTargetContentHash &&
    uniqueBlockers.length === 0;
  const operations: KnowledgeFileOperation[] = alreadyCurrent
    ? []
    : input.previousTargetContent === null
      ? [
          {
            path: targetPath,
            action: "delete",
            ownership: "user",
            mediaType: "application/json",
            expectedCurrentHash: targetContentHash,
            desiredHash: targetContentHash,
            reason: "rolled_back_pattern_agent_profile",
          },
        ]
      : [
          {
            path: targetPath,
            action: "update",
            ownership: "user",
            mediaType: "application/json",
            content: input.previousTargetContent,
            expectedCurrentHash: targetContentHash,
            desiredHash: input.previousTargetContentHash!,
            reason: "rolled_back_pattern_agent_profile",
          },
        ];
  const planId = stableId("kpatternplan", {
    operation: "agent_profile_rollback",
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    targetContentHash,
    restoredContentHash: input.previousTargetContentHash,
    blockers: uniqueBlockers,
    operations,
  });
  return {
    schemaVersion: 1,
    planKind: "development_pattern_rollback",
    planId,
    repositoryRoot: resolve(input.repositoryRoot),
    projectId: input.projectId,
    patternId: input.candidate.patternId,
    candidateContentHash: input.candidateContentHash,
    targetPath,
    targetContentHash,
    restoredContentHash: input.previousTargetContentHash,
    restoredContent: input.previousTargetContent,
    status: uniqueBlockers.length > 0 ? "blocked" : alreadyCurrent ? "current" : "ready",
    blockers: uniqueBlockers,
    operations,
  };
}

export function publicDevelopmentPatternRollbackPlan(plan: DevelopmentPatternRollbackPlan) {
  return {
    ...plan,
    restoredContent: undefined,
    operations: plan.operations.map(({ content: _content, ...operation }) => operation),
  };
}

export async function applyDevelopmentPatternRollback<T>(input: {
  plan: DevelopmentPatternRollbackPlan;
  approval: string;
  receipt: T;
  recordApplied: (receipt: T) => void | Promise<void>;
}): Promise<T> {
  if (input.plan.status === "blocked") throw new Error("Agent-profile rollback is blocked.");
  if (input.approval !== input.plan.planId)
    throw new Error("Approval must equal the exact agent-profile rollback plan ID.");
  return applyDurableKnowledgeOperations({
    repositoryRoot: input.plan.repositoryRoot,
    projectId: input.plan.projectId,
    planId: input.plan.planId,
    operations: input.plan.operations,
    receipt: input.receipt,
    recordApplied: input.recordApplied,
  });
}
