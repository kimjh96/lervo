import { ImprovementObservationPortError } from "@lervo/application-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { EventReadError, visitEventsOfTypes } from "@lervo/storage-contract";

import type { LocalImprovementEvidenceSourceV1 } from "./types.js";

const DEFAULT_MAXIMUM_EVIDENCE_EVENTS = 10_000;

function positiveBound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new TypeError(`${label} must be a positive safe integer.`);
}

function withinWindow(event: EventEnvelope, startedAt: number, endedAt: number): boolean {
  const occurredAt = Date.parse(event.occurredAt);
  return occurredAt >= startedAt && occurredAt <= endedAt;
}

/**
 * Reads `verification.completed` evidence through the observed head with a typed read (ADR-0554):
 * history length never bounds the read, and `maximumEvidenceEvents` bounds only retained evidence.
 */
export function createEventStoreImprovementEvidenceSource(input: {
  projectId: string;
  events: Pick<EventStore, "latest" | "list">;
  maximumEvidenceEvents?: number;
}): LocalImprovementEvidenceSourceV1 {
  const maximumEvidenceEvents = input.maximumEvidenceEvents ?? DEFAULT_MAXIMUM_EVIDENCE_EVENTS;
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
      const events: EventEnvelope[] = [];
      try {
        visitEventsOfTypes({
          events: input.events,
          types: ["verification.completed"],
          throughSeq: latest.seq,
          visit: (event) => {
            if (event.projectId !== input.projectId)
              throw new ImprovementObservationPortError(
                "evidence_invalid",
                "The local observation source contains another project.",
              );
            if (!withinWindow(event, startedAt, endedAt)) return;
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
