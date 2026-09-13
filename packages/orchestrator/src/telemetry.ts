import { randomUUID } from "node:crypto";
import { collectRunEventsBounded } from "@lervo/storage-contract";

import type { EventDraft, EventDraftV3 } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";

import type { ManagedEventStore, ManagedRunCoordinates } from "./types.js";

export interface ManagedEventSpec {
  eventId?: string;
  type: EventDraftV3["type"];
  schemaVersion?: 1 | 2 | 3;
  occurredAt: string;
  actor: EventDraft["actor"];
  payload: Readonly<Record<string, unknown>>;
}

export class TelemetryWriteError extends Error {
  constructor(options?: ErrorOptions) {
    super("Could not record managed run telemetry atomically.", options);
    this.name = "TelemetryWriteError";
  }
}

function defaultEventId(): string {
  return `evt_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

export class ManagedTelemetryRecorder {
  private readonly createEventId: () => string;

  constructor(
    private readonly events: ManagedEventStore,
    private readonly coordinates: ManagedRunCoordinates,
    private readonly policyVersion: string,
    createEventId?: () => string,
  ) {
    this.createEventId = createEventId ?? defaultEventId;
  }

  append(specs: readonly ManagedEventSpec[]): EventEnvelope[] {
    try {
      const drafts = specs.map((spec): EventDraft => {
        const { eventId, schemaVersion = 1, ...values } = spec;
        return {
          eventId: eventId ?? this.createEventId(),
          projectId: this.coordinates.projectId,
          runId: this.coordinates.runId,
          sessionId: this.coordinates.sessionId,
          schemaVersion,
          policyVersion: this.policyVersion,
          ...values,
        } as EventDraft;
      });
      return this.events.transact((transaction) => {
        if (drafts.some((draft) => draft.type === "run.requested")) {
          const prior = collectRunEventsBounded({
            events: this.events,
            runId: this.coordinates.runId,
            maximumEvents: 4096,
          });
          if (prior.some((event) => event.type === "run.requested"))
            throw new Error(
              "The managed run already has canonical execution evidence; inspect it before retrying.",
            );
        }
        return drafts.map((draft) => {
          const result = transaction.append(draft);
          if (result.redactions.length > 0) throw new TelemetryWriteError();
          return result.event;
        });
      });
    } catch (error) {
      throw new TelemetryWriteError({ cause: error });
    }
  }

  reserveEventId(): string {
    try {
      return this.createEventId();
    } catch (error) {
      throw new TelemetryWriteError({ cause: error });
    }
  }
}
