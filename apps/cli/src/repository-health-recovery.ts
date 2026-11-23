import type { KnowledgeConvergenceStatus } from "@lervo/repository-knowledge";

function duration(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds}ms` : `${Math.round(milliseconds / 1000)}s`;
}

/**
 * How a convergence stop recovers, in one line: the scheduled retry, the failed verification
 * command to fix (ADR-0562 section 3), or the owner recovery command. A failed verification is not
 * retried on a timer: it reruns once the sources or Lervo change, so the line says that instead of
 * promising a retry. Without any of them the line says none is recorded.
 */
export function convergenceRecovery(
  status: Pick<KnowledgeConvergenceStatus, "retry" | "recoveryCommand" | "verificationFailure">,
): string {
  if (status.retry?.nextAttemptAt) return `retry at ${status.retry.nextAttemptAt}`;
  const failure = status.verificationFailure;
  if (failure && typeof failure.commandId === "string" && typeof failure.status === "string") {
    const exit = Number.isSafeInteger(failure.exitCode) ? ` exit ${failure.exitCode}` : "";
    const after =
      Number.isSafeInteger(failure.durationMs) && failure.durationMs! >= 0
        ? ` after ${duration(failure.durationMs!)}`
        : "";
    return `fix verification command ${failure.commandId} (${failure.status}${exit}${after}); it reruns after a source or Lervo change (lervo knowledge convergence status)`;
  }
  if (status.recoveryCommand) return `inspect ${status.recoveryCommand}`;
  return "none recorded (lervo knowledge convergence status)";
}
