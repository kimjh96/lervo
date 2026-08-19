import { randomUUID } from "node:crypto";

import type { EventDraft } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

import {
  DeliberationRuntimeError,
  type DeliberationRuntimeCoordinates,
} from "./types.js";

export interface DeliberationEventSpec {
  type: Extract<EventDraft["type"],
    | "deliberation.started"
    | "deliberation.artifact.recorded"
    | "deliberation.completed"
    | "context.published"
    | "handoff.created">;
  coordinates: DeliberationRuntimeCoordinates;
  occurredAt: string;
  actor: EventDraft["actor"];
  payload: Readonly<Record<string, unknown>>;
}

function defaultEventId(): string {
  return `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export class DeliberationEventRecorder {
  private readonly createEventId: () => string;

  constructor(
    private readonly events: EventStore,
    private readonly policyVersion: string,
    createEventId?: () => string,
  ) {
    this.createEventId = createEventId ?? defaultEventId;
  }

  append(spec: DeliberationEventSpec): EventEnvelope {
    return this.appendMany([spec])[0]!;
  }

  appendMany(specs: readonly DeliberationEventSpec[]): EventEnvelope[] {
    try {
      return this.events.transact((transaction) => {
        return specs.map((spec) => {
          const result = transaction.append({
            eventId: this.createEventId(),
            projectId: spec.coordinates.projectId,
            runId: spec.coordinates.runId,
            sessionId: spec.coordinates.sessionId,
            schemaVersion: 1,
            policyVersion: this.policyVersion,
            type: spec.type,
            occurredAt: spec.occurredAt,
            actor: spec.actor,
            payload: spec.payload,
          });
          if (result.redactions.length > 0) {
            throw new DeliberationRuntimeError(
              "event_recording_failed",
              "event_redacted",
              "숙의 event의 허용되지 않은 필드를 제거하지 않고 기록을 중단했습니다.",
            );
          }
          return result.event;
        });
      });
    } catch (error) {
      if (error instanceof DeliberationRuntimeError) throw error;
      throw new DeliberationRuntimeError(
        "event_recording_failed",
        "event_store_failed",
        "숙의 event를 원자적으로 기록하지 못했습니다.",
        { cause: error },
      );
    }
  }
}
