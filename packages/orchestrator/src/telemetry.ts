import { randomUUID } from "node:crypto";

import type { EventDraft } from "@lervo/event-contract";
import type { EventEnvelope } from "@lervo/schemas";

import type { ManagedEventStore, ManagedRunCoordinates } from "./types.js";

export interface ManagedEventSpec {
  type: EventDraft["type"];
  occurredAt: string;
  actor: EventDraft["actor"];
  payload: Readonly<Record<string, unknown>>;
}

export class TelemetryWriteError extends Error {
  constructor() {
    super("Could not record managed run telemetry atomically.");
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
      const drafts = specs.map(
        (spec): EventDraft => ({
          eventId: this.createEventId(),
          projectId: this.coordinates.projectId,
          runId: this.coordinates.runId,
          sessionId: this.coordinates.sessionId,
          schemaVersion: 1,
          policyVersion: this.policyVersion,
          ...spec,
        }),
      );
      return this.events.transact((transaction) =>
        drafts.map((draft) => {
          const result = transaction.append(draft);
          if (result.redactions.length > 0) throw new TelemetryWriteError();
          return result.event;
        }),
      );
    } catch {
      throw new TelemetryWriteError();
    }
  }
}
