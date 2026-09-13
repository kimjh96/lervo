import type { ArtifactStore } from "@lervo/storage-contract";
import { type EventEnvelope } from "@lervo/schemas";
import { readSupervisionJsonArtifact } from "./supervision-artifact-json.js";
import { isProvenPreTurnFailure } from "./supervision-pre-turn-failure.js";
import { observedSupervisionRunTermination } from "./supervision-run-termination.js";

/** A stopped turn is safely repeatable only when its actual session cannot perform tool effects. */
export async function observeSupervisionFailure(
  events: readonly EventEnvelope[],
  artifacts: ArtifactStore,
) {
  const terminal = events.find((event) => event.type === "run.failed");
  if (terminal === undefined) return null;
  if (
    Object.keys(terminal.payload).sort().join(",") !== "diagnosticDigest,failureCode,retryable" ||
    typeof terminal.payload.retryable !== "boolean" ||
    !/^[a-z_]{1,64}$/u.test(String(terminal.payload.failureCode)) ||
    !/^sha256:[a-f0-9]{64}$/u.test(String(terminal.payload.diagnosticDigest))
  )
    throw new Error("The failed task has malformed terminal evidence.");
  const hash = String(terminal.payload.diagnosticDigest);
  if (!(await artifacts.has(`lervo-cas://sha256/${hash.slice(7)}`)))
    return {
      status: "uncertain" as const,
      reasonCode: "failure_diagnostic_unavailable",
      diagnostic: null,
    };
  const diagnostic = (await readSupervisionJsonArtifact(artifacts, hash)) as {
    failures: { code: string; phase: string; retryable: boolean }[];
  };
  if (terminal.payload.failureCode === "interrupted_before_turn") {
    const safe = isProvenPreTurnFailure(events, diagnostic);
    return {
      status: safe ? ("known_safe_failure" as const) : ("uncertain" as const),
      reasonCode: safe ? "fenced_pre_turn_interruption" : "pre_turn_recovery_unverified",
      diagnostic: safe ? diagnostic : null,
    };
  }
  if (
    diagnostic === null ||
    typeof diagnostic !== "object" ||
    Object.keys(diagnostic).join(",") !== "failures" ||
    !Array.isArray(diagnostic.failures) ||
    diagnostic.failures.length === 0 ||
    diagnostic.failures.length > 64 ||
    diagnostic.failures.some(
      (item) =>
        item === null ||
        typeof item !== "object" ||
        Object.keys(item).sort().join(",") !== "code,phase,retryable" ||
        !/^[a-z_]{1,64}$/u.test(item.code) ||
        !/^[a-z_]{1,64}$/u.test(item.phase) ||
        typeof item.retryable !== "boolean",
    ) ||
    !diagnostic.failures.some((item) => item.code === terminal.payload.failureCode)
  )
    throw new Error("The failed task diagnostic differs from its canonical terminal event.");
  const started = events.filter((event) => event.type === "adapter.started");
  const capabilities = started[0]?.payload.capabilities as Record<string, unknown> | undefined;
  const settled = observedSupervisionRunTermination(events);
  const safe =
    started.length === 1 &&
    started[0]!.payload.executionMode === "read_only" &&
    ["toolCalls", "commandExecution", "fileChanges"].every(
      (key) => capabilities?.[key] === "unsupported",
    ) &&
    settled?.terminal.eventId === terminal.eventId &&
    started[0]!.seq < settled.stopped.seq &&
    diagnostic.failures.every(
      (item) =>
        [
          "turn_start",
          "provider_turn",
          "provider_stream",
          "result_collect",
          "result_store",
        ].includes(item.phase) &&
        [
          "provider_turn_failed",
          "provider_stream_failed",
          "provider_result_failed",
          "artifact_storage_failed",
        ].includes(item.code),
    ) &&
    !events.some((event) =>
      [
        "tool.called",
        "command.executed",
        "file.changed",
        "capability.activated",
        "capability.invoked",
        "unmanaged_change.detected",
      ].includes(event.type),
    );
  return {
    status: safe ? ("known_safe_failure" as const) : ("uncertain" as const),
    reasonCode: safe ? "settled_no_tool_failure" : "failure_effects_require_inspection",
    diagnostic,
  };
}
