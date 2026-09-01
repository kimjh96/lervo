import { randomUUID } from "node:crypto";

import { inspectEventWriterCoordinate } from "@lervo/project";
import { openProjectStorage, type ProjectStorage } from "@lervo/project-storage";
import { validateSchema } from "@lervo/schemas";

import type { TerminalStageObservationPort } from "./terminal-stage-observation.js";

function eventId(): string {
  return `evt_${randomUUID().replaceAll("-", "")}`;
}

export async function recordTerminalStageObservation(input: {
  root: string;
  coordinates: { runId: string; sessionId: string };
  observationId: string;
  hookEvent: "UserPromptSubmit" | "Stop";
  timing: TerminalStageObservationPort;
  outcome: "completed" | "failed";
  policyVersion: string;
  storage?: ProjectStorage;
}): Promise<string | null> {
  const writer = await inspectEventWriterCoordinate(input.root);
  if (writer.coordinate.selectedEventSchemaVersion !== 2) return null;
  const finalized = input.timing.finalize(input.observationId, input.hookEvent, input.outcome);
  if (finalized === null) return null;
  const validation = validateSchema("executionStagesObservedEventPayload", finalized.payload);
  if (!validation.valid) throw new Error("Terminal stage observation is invalid.");
  const storage = input.storage ?? (await openProjectStorage(input.root));
  try {
    const stored = await storage.artifacts.put(finalized.profileBytes);
    const restored = await storage.artifacts.get(stored.uri);
    if (
      stored.contentHash !== finalized.profileHash ||
      restored.length !== finalized.profileBytes.length ||
      restored.some((byte, index) => byte !== finalized.profileBytes[index])
    ) {
      throw new Error("Terminal environment profile persistence is invalid.");
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
      schemaVersion: 2,
      policyVersion: input.policyVersion,
      payload: finalized.payload,
    });
    return recordedEventId;
  } finally {
    if (input.storage === undefined) await storage.close();
  }
}
