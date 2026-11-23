import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/**
 * A failed or cancelled suite stops the stage. The failure names the suite's result artifact as
 * its dependency, so the status can say which command failed and how (ADR-0562 section 3).
 */
export function assertConvergenceVerificationPassed(
  status: "passed" | "failed" | "cancelled",
  resultArtifactHash?: string,
) {
  if (status === "passed") return;
  const error = new KnowledgeConvergenceRuntimeError(
    status === "cancelled" ? "knowledge_cancelled" : "knowledge_verification_failed",
  );
  throw resultArtifactHash === undefined
    ? error
    : Object.assign(error, { dependencyHash: resultArtifactHash });
}
