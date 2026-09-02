import { ImprovementObservationPortError } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { EventReadError, visitEventSnapshot } from "@lervo/storage-contract";

import type { LocalImprovementEvidenceSourceV1 } from "./types.js";

const DEFAULT_MAXIMUM_SCANNED_EVENTS = 100_000;
const DEFAULT_MAXIMUM_EVIDENCE_EVENTS = 10_000;

function positiveBound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`${label} must be a positive safe integer.`);
}

function withinWindow(event: EventEnvelope, startedAt: number, endedAt: number): boolean {
  const occurredAt = Date.parse(event.occurredAt);
  return occurredAt >= startedAt && occurredAt <= endedAt;
}

export function createEventStoreImprovementEvidenceSource(input: {
  projectId: string;
  events: Pick<EventStore, "latest" | "list">;
  maximumScannedEvents?: number;
  maximumEvidenceEvents?: number;
}): LocalImprovementEvidenceSourceV1 {
  const maximumScannedEvents = input.maximumScannedEvents ?? DEFAULT_MAXIMUM_SCANNED_EVENTS;
  const maximumEvidenceEvents = input.maximumEvidenceEvents ?? DEFAULT_MAXIMUM_EVIDENCE_EVENTS;
  positiveBound(maximumScannedEvents, "maximumScannedEvents");
  positiveBound(maximumEvidenceEvents, "maximumEvidenceEvents");
  return {
    readWindow: async (window) => {
      const startedAt = Date.parse(window.startedAt);
      const endedAt = Date.parse(window.endedAt);
      if (!Number.isFinite(startedAt) || !Number.isFinite(endedAt) || startedAt > endedAt)
        throw new ImprovementObservationPortError(
          "request_invalid",
          "The local improvement observation window is invalid.",
        );
      const latest = input.events.latest();
      if (latest === null) return { schemaVersion: 1, projectId: input.projectId, events: [] };
      if (latest.seq > maximumScannedEvents)
        throw new ImprovementObservationPortError(
          "evidence_limit_exceeded",
          "The local event snapshot exceeds the configured observation scan limit.",
        );
      const events: EventEnvelope[] = [];
      try {
        visitEventSnapshot({
          events: input.events,
          throughSeq: latest.seq,
          visit: (event) => {
            if (event.projectId !== input.projectId)
              throw new ImprovementObservationPortError(
                "evidence_invalid",
                "The local observation source contains another project.",
              );
            if (event.type !== "verification.completed" || !withinWindow(event, startedAt, endedAt))
              return;
            if (events.length >= maximumEvidenceEvents)
              throw new ImprovementObservationPortError(
                "evidence_limit_exceeded",
                "The local observation evidence set exceeds its configured limit.",
              );
            events.push(event);
          },
        });
      } catch (error) {
        if (error instanceof ImprovementObservationPortError) throw error;
        throw new ImprovementObservationPortError(
          error instanceof EventReadError && error.code === "event_limit_exceeded"
            ? "evidence_limit_exceeded"
            : "evidence_invalid",
          "The local improvement observation event snapshot is unavailable.",
          { cause: error },
        );
      }
      return { schemaVersion: 1, projectId: input.projectId, events };
    },
  };
}
