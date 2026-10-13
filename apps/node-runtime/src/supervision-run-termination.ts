import { PRE_START_FAILURES } from "@lervo/work-controller";
import type { EventEnvelope } from "@lervo/schemas";

/** A successful stop acknowledgement can carry a failed/cancelled turn reason; it is not acceptance. */
export function observedSupervisionRunTermination(events: readonly EventEnvelope[]) {
  const terminals = events.filter(
    (event) => event.type === "run.completed" || event.type === "run.failed",
  );
  const stops = events.filter((event) => event.type === "adapter.stopped");
  if (terminals.length !== 1 || stops.length !== 1) return null;
  const terminal = terminals[0]!;
  const stopped = stops[0]!;
  if (
    terminal.runId !== stopped.runId ||
    terminal.sessionId !== stopped.sessionId ||
    stopped.seq >= terminal.seq ||
    (terminal.type === "run.completed"
      ? stopped.payload.status !== "completed"
      : !["completed", "failed", "cancelled"].includes(String(stopped.payload.status)))
  )
    return null;
  return { terminal, stopped };
}

/**
 * A managed run that failed terminally before its provider adapter started: one nonretryable
 * system failure from a pre-start phase, with no adapter start, provider process, or stop.
 */
export function observedSupervisionPreStartFailure(events: readonly EventEnvelope[]) {
  const terminals = events.filter(
    (event) => event.type === "run.completed" || event.type === "run.failed",
  );
  const terminal = terminals[0];
  if (
    terminals.length !== 1 ||
    terminal!.type !== "run.failed" ||
    terminal!.actor.kind !== "system" ||
    terminal!.payload.retryable !== false ||
    !PRE_START_FAILURES.includes(String(terminal!.payload.failureCode)) ||
    events.some((event) =>
      ["adapter.started", "provider.process.observed", "adapter.stopped"].includes(event.type),
    )
  )
    return null;
  return { terminal: terminal! };
}
