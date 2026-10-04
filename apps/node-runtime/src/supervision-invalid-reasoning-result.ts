import type { EventEnvelope } from "@lervo/schemas";
import type { ProjectStorage } from "@lervo/project-storage";
import { collectRunEventsBounded } from "@lervo/storage-contract";
import { observedSupervisionRunTermination } from "./supervision-run-termination.js";
import { readSupervisionTextArtifact } from "./supervision-artifact-json.js";

/** A failed JSON projection is retryable proposal evidence only after exact stop and observed usage. */
export function invalidReasoningResultCapture(events: readonly EventEnvelope[], runId: string) {
  const run = events.filter((event) => event.runId === runId);
  const termination = observedSupervisionRunTermination(run);
  const captures = run.filter((event) => event.type === "adapter.result.captured");
  const result = captures.length === 1 ? captures[0] : undefined;
  if (
    termination?.terminal.type !== "run.failed" ||
    termination.terminal.payload.failureCode !== "contract_validation_failed" ||
    !["completed", "failed"].includes(String(termination.stopped.payload.status)) ||
    !result ||
    result.sessionId !== termination.terminal.sessionId ||
    result.seq >= termination.stopped.seq ||
    result.payload.referenceTelemetry !== "supported" ||
    !run.some(
      (event) =>
        event.type === "resource.usage.recorded" &&
        event.seq < termination.terminal.seq &&
        event.payload.status === "observed",
    )
  )
    return null;
  return result;
}

export async function readInvalidReasoningResult(
  storage: Pick<ProjectStorage, "events" | "artifacts">,
  runId: string,
) {
  const run = collectRunEventsBounded({ events: storage.events, runId, maximumEvents: 4096 });
  const captured = invalidReasoningResultCapture(run, runId);
  if (!captured) return null;
  const hash = String(captured.payload.resultDigest);
  const text = await readSupervisionTextArtifact(storage.artifacts, hash);
  try {
    JSON.parse(text);
  } catch {
    return hash;
  }
  return null;
}
