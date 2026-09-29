import { listWorkspaceIntegrationAttempts } from "@lervo/agent-workforce";
import { repositoryCoordinateDigest } from "@lervo/project-storage";
import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Target generations fence the shared ref, independently of any assignment's lease generation. */
export async function nextConvergenceIntegrationGeneration(
  root: string,
  ref: string,
): Promise<number> {
  const digest = repositoryCoordinateDigest(ref);
  const attempts = (await listWorkspaceIntegrationAttempts(root)).filter(
    (attempt) => attempt.targetDigest === digest,
  );
  if (attempts.some((attempt) => attempt.state !== "integrated"))
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  const generation =
    attempts.reduce((maximum, attempt) => Math.max(maximum, attempt.targetGeneration), 0) + 1;
  if (!Number.isSafeInteger(generation))
    throw new KnowledgeConvergenceRuntimeError("knowledge_effect_uncertain");
  return generation;
}
