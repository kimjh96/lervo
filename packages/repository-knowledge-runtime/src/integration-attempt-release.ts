import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import {
  AgentWorkforceError,
  listWorkspaceIntegrationAttempts,
  readWorkspaceIntegrationAttempt,
  releaseWorkspaceIntegrationAttempt,
  requeueReleasedIntegrationSources,
} from "@lervo/agent-workforce";
import { ProjectStorageError, repositoryCoordinateDigest } from "@lervo/project-storage";
import { resolveIntegrationTarget } from "./integration-target-sync.js";

const execute = promisify(execFile);

/** Whether the ref names the candidate or descends from it; an unreadable object throws. */
async function candidateReachedTarget(root: string, ref: string, candidate: string) {
  const target = await resolveIntegrationTarget(root, ref);
  if (target === null) return false;
  if (target === candidate) return true;
  try {
    await execute("git", ["-C", root, "merge-base", "--is-ancestor", candidate, target]);
    return true;
  } catch (error) {
    // Exit 1 means "not an ancestor"; any other failure leaves the attempt blocking.
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

/**
 * Releases one target attempt whose effect never reached the target. Returns whether it is now
 * released; a refusal (candidate reached the target, creating lease live, `advancing`, or a
 * concurrent change) leaves it blocking.
 */
export async function releaseConvergenceIntegrationAttempt(input: {
  root: string;
  ref: string;
  targetLeaseId: string;
  holderLeaseId?: string;
}): Promise<boolean> {
  const stored = await readWorkspaceIntegrationAttempt(input.root, input.targetLeaseId);
  if (stored === null) return false;
  if (stored.attempt.state === "released") {
    // Finishes a requeue that stopped after the attempt itself was released.
    await requeueReleasedIntegrationSources({
      repositoryRoot: input.root,
      targetLeaseId: input.targetLeaseId,
      occurredAt: new Date().toISOString(),
    });
    return true;
  }
  try {
    await releaseWorkspaceIntegrationAttempt({
      repositoryRoot: input.root,
      targetLeaseId: input.targetLeaseId,
      expectedContentHash: stored.contentHash,
      expectedRevision: stored.attempt.revision,
      eventId: `evt_${randomBytes(12).toString("hex")}`,
      occurredAt: new Date().toISOString(),
      ...(input.holderLeaseId === undefined ? {} : { holderLeaseId: input.holderLeaseId }),
      candidateReachedTarget: (candidate) =>
        candidateReachedTarget(input.root, input.ref, candidate),
    });
    return true;
  } catch (error) {
    if (
      (error instanceof AgentWorkforceError && error.code === "workspace_transition_conflict") ||
      (error instanceof ProjectStorageError && error.code === "coordination_state_conflict")
    )
      return false;
    throw error;
  }
}

/**
 * Releases attempts on this target whose creating lease ended, or is `holderLeaseId` itself after
 * a restart, without their effect reaching the target, and returns every released attempt's
 * remaining `integrating` sources to their queue. A failing attempt is skipped: the generation
 * check that follows still blocks on it.
 */
export async function releaseOrphanedConvergenceIntegrationAttempts(
  root: string,
  ref: string,
  holderLeaseId?: string,
): Promise<void> {
  const digest = repositoryCoordinateDigest(ref);
  for (const attempt of await listWorkspaceIntegrationAttempts(root))
    if (
      attempt.targetDigest === digest &&
      ["leased", "candidate", "conflict", "released"].includes(attempt.state)
    )
      await releaseConvergenceIntegrationAttempt({
        root,
        ref,
        targetLeaseId: attempt.targetLeaseId,
        ...(holderLeaseId === undefined ? {} : { holderLeaseId }),
      }).catch(() => false);
}
