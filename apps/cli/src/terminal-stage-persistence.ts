import { randomUUID } from "node:crypto";

import { hookDeliveryEventSchemaVersion } from "@lervo/event-contract";
import { inspectEventWriterCoordinate } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { validateSchema, type TerminalHookFailureReason } from "@lervo/schemas";

import { TerminalHookFailure, withinTerminalDeadline } from "./terminal-hook-budget.js";
import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";

function eventId(): string {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}

export async function recordTerminalStageObservation(input: {
  root: string;
  coordinates: { runId: string; sessionId: string };
  observationId: string;
  hookEvent?: "UserPromptSubmit" | "Stop";
  timing: TerminalStageObservationPort;
  outcome: "completed" | "failed";
  policyVersion: string;
  failureReason?: TerminalHookFailureReason;
  storage?: ProjectStorage;
}): Promise<string | null> {
  const operation = () => persistTerminalStageObservation(input);
  try {
    return input.timing.observationDeadlineMs === undefined
      ? await operation()
      : await withinTerminalDeadline(input.timing.observationDeadlineMs, operation);
  } catch (error) {
    if (error instanceof TerminalHookFailure) throw error;
    throw new TerminalHookFailure("event_persistence_failed");
  }
}

async function persistTerminalStageObservation(
  input: Parameters<typeof recordTerminalStageObservation>[0],
): Promise<string | null> {
  await input.timing.settle?.();
  const writerVersion =
    input.storage?.writableEventSchemaVersion ??
    (await inspectEventWriterCoordinate(input.root)).coordinate.selectedEventSchemaVersion;
  // Stage observations are version-2 events, which every later writer also accepts.
  if (writerVersion < 2) return null;
  const finalized = input.timing.finalize(input.observationId, input.hookEvent, input.outcome);
  if (finalized === null) return null;
  if (input.failureReason !== undefined) finalized.payload.failureReason = input.failureReason;
  // How the answer was delivered is a schema-13 field; an older writer records the stages alone.
  const delivery = input.timing.delivery?.();
  if (delivery !== undefined && writerVersion >= hookDeliveryEventSchemaVersion)
    finalized.payload.delivery = delivery;
  if (input.outcome === "failed" && input.failureReason === undefined)
    throw new Error("Failed terminal stages require a closed reason code.");
  const validation = validateSchema("executionStagesObservedEventPayload", finalized.payload);
  if (!validation.valid) throw new Error("Terminal stage observation is invalid.");
  const storage = input.storage ?? (await openProjectStorage(input.root));
  try {
    const profileUri = `lervo-cas://sha256/${finalized.profileHash.slice("sha256:".length)}`;
    if (!(await storage.artifacts.has(profileUri))) {
      const stored = await storage.artifacts.put(finalized.profileBytes);
      if (
        stored.contentHash !== finalized.profileHash ||
        stored.byteCount !== finalized.profileBytes.length
      ) {
        throw new Error("Terminal environment profile persistence is invalid.");
      }
    }
    const recordedEventId = eventId();
    storage.events.append({
      eventId: recordedEventId,
      projectId: storage.manifest.projectId,
      runId: input.coordinates.runId,
      sessionId: input.coordinates.sessionId,
      type: "execution.stages.observed",
      occurredAt: new Date().toISOString(),
      actor: { kind: "system" },
      schemaVersion: finalized.payload.delivery === undefined ? 2 : hookDeliveryEventSchemaVersion,
      policyVersion: input.policyVersion,
      payload: finalized.payload,
    });
    return recordedEventId;
  } finally {
    if (input.storage === undefined) await storage.close();
  }
}
