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
