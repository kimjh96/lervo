import { listWorkspaceIntegrationAttempts } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";
import { releaseOrphanedConvergenceIntegrationAttempts } from "./integration-attempt-release.js";

/**
 * Target generations fence the shared ref, independently of any assignment's lease generation.
 * Released attempts no longer block but still count, so a generation is never reused.
 */
export async function nextConvergenceIntegrationGeneration(
  root: string,
  ref: string,
  /** The planning lease, which may release an attempt it created before a restart. */
  holderLeaseId?: string,
): Promise<number> {
  await releaseOrphanedConvergenceIntegrationAttempts(root, ref, holderLeaseId);
  const digest = repositoryCoordinateDigest(ref);
  const attempts = (await listWorkspaceIntegrationAttempts(root)).filter(
    (attempt) => attempt.targetDigest === digest,
  );
  if (attempts.some((attempt) => !["integrated", "released"].includes(attempt.state)))
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const generation =
    attempts.reduce((maximum, attempt) => Math.max(maximum, attempt.targetGeneration), 0) + 1;
  if (!Number.isSafeInteger(generation))
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  return generation;
}
