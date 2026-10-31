import {
  validateSchema,
  type EventEnvelope,
  type ExecutionStagesObservedEventPayload,
  type TerminalTurnCoverage,
} from "@lervo/schemas";
import { assertExecutionStageSet } from "@lervo/execution-contract";

export function terminalStageCoverage(
  context: EventEnvelope,
  turn: EventEnvelope | undefined,
  events: EventEnvelope[],
): TerminalTurnCoverage["stages"] {
  const observationId = context.payload.observationId;
  const byId = new Map<string, TerminalTurnCoverage["stages"]["observations"][number]>();
  const byHook = new Map<string, string>();
  let invalid = false;
  let legacyHookCoordinateUnavailable = false;
  for (const event of events.filter(
    (item) =>
      item.type === "execution.stages.observed" &&
      item.payload.terminalObservationId === observationId,
  )) {
    if (!validateSchema("executionStagesObservedEventPayload", event.payload).valid) {
      invalid = true;
      continue;
    }
    const payload = event.payload as ExecutionStagesObservedEventPayload;
    if (payload.terminalHook !== "UserPromptSubmit" && payload.terminalHook !== "Stop") {
      legacyHookCoordinateUnavailable = true;
      continue;
    }
    const hookEvent = payload.terminalHook as "UserPromptSubmit" | "Stop";
    const stages = payload.stages;
    if (
      payload.executionMode !== "unmanaged_terminal" ||
      event.runId !== context.runId ||
      event.sessionId !== context.sessionId ||
      !Array.isArray(stages)
    ) {
      invalid = true;
      continue;
    }
    try {
      assertExecutionStageSet(stages as Parameters<typeof assertExecutionStageSet>[0]);
    } catch {
      invalid = true;
      continue;
    }
    const observation = {
      hookEvent,
      observationSetId: payload.observationSetId,
      environmentProfileDigest: payload.environmentProfileDigest,
      repositoryProfile: payload.repositoryProfile,
      stages: stages as TerminalTurnCoverage["stages"]["observations"][number]["stages"],
    };
    const existing = byId.get(observation.observationSetId);
    if (existing !== undefined) {
      if (JSON.stringify(existing) !== JSON.stringify(observation)) invalid = true;
      continue;
    }
    const hookObservationId = byHook.get(hookEvent);
    if (hookObservationId !== undefined && hookObservationId !== observation.observationSetId) {
      invalid = true;
      continue;
    }
    byHook.set(hookEvent, observation.observationSetId);
    byId.set(observation.observationSetId, observation);
  }
  const expectedHooks = turn === undefined ? ["UserPromptSubmit"] : ["UserPromptSubmit", "Stop"];
  const missing = expectedHooks.filter((hook) => !byHook.has(hook));
  const observations = [...byId.values()].sort((left, right) =>
    left.hookEvent.localeCompare(right.hookEvent),
  );
  return {
    completeness: invalid
      ? "invalid"
      : observations.length === 0
        ? "unavailable"
        : missing.length > 0
          ? "partial"
          : "complete",
    missingReasons: [
      ...(invalid ? ["stage_observation_invalid"] : []),
      ...(legacyHookCoordinateUnavailable ? ["stage_hook_coordinate_unavailable"] : []),
      ...(missing.length > 0 ? ["stage_observation_missing"] : []),
    ],
    observations,
  };
}
