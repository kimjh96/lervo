import { KnowledgeConvergenceRuntimeError } from "./failure.js";

export function assertConvergenceVerificationPassed(status: "passed" | "failed" | "cancelled") {
  if (status === "passed") return;
  throw new KnowledgeConvergenceRuntimeError(
    status === "cancelled" ? "knowledge_cancelled" : "knowledge_verification_failed",
  );
}
