import {
  VERIFICATION_ENVIRONMENT_FAILED,
  VERIFICATION_TIMED_OUT,
} from "@lervo/repository-knowledge";
import type { VerificationResult } from "@lervo/schemas";

import { KnowledgeConvergenceRuntimeError } from "./failure.js";

/** Shell exit codes for a command that was found but not executable, or not found at all. */
const COMMAND_UNAVAILABLE_EXIT_CODES = new Set([126, 127]);

/**
 * The failure code the first command that did not pass earns. A command that could not start or
 * whose program was missing failed because of the host and is retried with backoff. One that ran
 * out of time settles and is reevaluated later. One that ran and reported a failure waits for a
 * source or Lervo change.
 */
function failedCommandCode(result: Pick<VerificationResult, "commands">): string {
  const failed = result.commands.find(
    (command) => command.status !== "passed" && command.status !== "not_run",
  );
  if (failed?.status === "timed_out") return VERIFICATION_TIMED_OUT;
  return failed?.status === "execution_error" ||
    (failed?.status === "failed" &&
      failed.exitCode !== null &&
      COMMAND_UNAVAILABLE_EXIT_CODES.has(failed.exitCode))
    ? VERIFICATION_ENVIRONMENT_FAILED
    : "knowledge_verification_failed";
}

/**
 * A failed or cancelled suite stops the stage. The failure names the suite's result artifact as
 * its dependency, so the status can say which command failed and how (ADR-0562 section 3). A
 * failure the host may have caused gets its own code.
 */
export function convergenceVerificationFailure(
  result: Pick<VerificationResult, "status" | "commands">,
  resultArtifactHash: string,
): KnowledgeConvergenceRuntimeError | null {
  if (result.status === "passed") return null;
  const code = result.status === "cancelled" ? "knowledge_cancelled" : failedCommandCode(result);
  return Object.assign(new KnowledgeConvergenceRuntimeError(code), {
    dependencyHash: resultArtifactHash,
  });
}

export function assertConvergenceVerificationPassed(
  result: Pick<VerificationResult, "status" | "commands">,
  resultArtifactHash: string,
): void {
  const failure = convergenceVerificationFailure(result, resultArtifactHash);
  if (failure !== null) throw failure;
}
