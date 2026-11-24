import {
  VERIFICATION_ENVIRONMENT_FAILED,
  VERIFICATION_TIMED_OUT,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";

function duration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds}ms` : `${Math.round(milliseconds / 1000)}s`;
}

/**
 * How a convergence stop recovers, in one line: the scheduled retry, the failed verification
 * command to fix (ADR-0562 section 3), or the owner recovery command. A command that ran and failed
 * is not retried on a timer: it reruns once the sources or Lervo change. A command the host could
 * not start or find has used its backoff retries, and one that ran out of time settled at once;
 * both are checked again after a pause.
 * Without any of them the line says none is recorded.
 */
export function convergenceRecovery(
  status: Pick<KnowledgeConvergenceStatus, "retry" | "recoveryCommand" | "verificationFailure"> & {
    reason?: KnowledgeConvergenceStatus["reason"];
  },
): string {
  if (status.retry?.nextAttemptAt) return `retry at ${status.retry.nextAttemptAt}`;
  const failure = status.verificationFailure;
  if (failure && typeof failure.commandId === "string" && typeof failure.status === "string") {
    const exit = Number.isSafeInteger(failure.exitCode) ? ` exit ${failure.exitCode}` : "";
    const after =
      Number.isSafeInteger(failure.durationMs) && failure.durationMs! >= 0
        ? ` after ${duration(failure.durationMs!)}`
        : "";
    const detail = `${failure.commandId} (${failure.status}${exit}${after})`;
    if (status.reason === VERIFICATION_ENVIRONMENT_FAILED)
      return `verification command ${detail} could not run on this host after backoff retries; it reruns within 6 hours or after a source or Lervo change (lervo knowledge convergence status)`;
    if (status.reason === VERIFICATION_TIMED_OUT)
      return `verification command ${detail} ran out of time; it reruns within 6 hours or after a source or Lervo change (lervo knowledge convergence status)`;
    return `fix verification command ${detail}; it reruns after a source or Lervo change (lervo knowledge convergence status)`;
  }
  if (status.recoveryCommand) return `inspect ${status.recoveryCommand}`;
  return "none recorded (lervo knowledge convergence status)";
}
