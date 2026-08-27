import type { EventEnvelope } from "@lervo/schemas";
import { EventReadError, visitEventSnapshot, type EventStore } from "@lervo/storage-contract";

export const maximumDeliberationTraceEvents = 1_000;

export interface DeliberationEventSnapshot {
  started: EventEnvelope[];
  artifacts: EventEnvelope[];
  failedPublications: EventEnvelope[];
  completed: EventEnvelope[];
  traceEvents: EventEnvelope[];
}

function scanSnapshot(input: {
  events: Pick<EventStore, "list">;
  eventCount: number;
  visit(event: EventEnvelope): void;
}): void {
  try {
    visitEventSnapshot({
      events: input.events,
      throughSeq: input.eventCount,
      visit: input.visit,
    });
  } catch (error) {
    if (!(error instanceof EventReadError)) throw error;
    throw Object.assign(
      new Error("The deliberation diagnostic event snapshot could not be read completely.", {
        cause: error,
      }),
      {
        code: "deliberation_history_invalid",
      },
    );
  }
}

export function readDeliberationEventSnapshot(input: {
  events: Pick<EventStore, "list">;
  eventCount: number;
  deliberationId: string;
  checkpointEventIds: ReadonlySet<string>;
  checkpointRunIds: ReadonlySet<string>;
}): DeliberationEventSnapshot {
  if (!Number.isSafeInteger(input.eventCount) || input.eventCount < 0) {
    throw new TypeError("The deliberation diagnostic event snapshot size is invalid.");
  }
  const started: EventEnvelope[] = [];
  const artifacts: EventEnvelope[] = [];
  const failedPublications: EventEnvelope[] = [];
  const completed: EventEnvelope[] = [];
  const relatedRunIds = new Set(input.checkpointRunIds);
  const matchedCheckpointEventIds = new Set<string>();

  scanSnapshot({
    events: input.events,
    eventCount: input.eventCount,
    visit: (event) => {
      if (input.checkpointEventIds.has(event.eventId)) {
        matchedCheckpointEventIds.add(event.eventId);
        relatedRunIds.add(event.runId);
      }
      if (
        event.type === "deliberation.started" &&
        event.payload.deliberationId === input.deliberationId
      )
        started.push(event);
      if (
        event.type === "deliberation.artifact.recorded" &&
        event.payload.deliberationId === input.deliberationId
      )
        artifacts.push(event);
      if (
        event.type === "deliberation.artifact.publication_failed" &&
        event.payload.deliberationId === input.deliberationId
      )
        failedPublications.push(event);
      if (
        event.type === "deliberation.completed" &&
        event.payload.deliberationId === input.deliberationId
      )
        completed.push(event);
      if (
        started.length + artifacts.length + failedPublications.length + completed.length >
        maximumDeliberationTraceEvents
      ) {
        throw Object.assign(new Error("The deliberation trace contains more than 1,000 events."), {
          code: "deliberation_trace_too_large",
        });
      }
    },
  });
  if (matchedCheckpointEventIds.size !== input.checkpointEventIds.size) {
    throw Object.assign(
      new Error("The deliberation checkpoint events do not match the current snapshot."),
      {
        code: "deliberation_history_invalid",
      },
    );
  }
  [...started, ...artifacts, ...failedPublications, ...completed].forEach((event) =>
    relatedRunIds.add(event.runId),
  );

  const traceEvents: EventEnvelope[] = [];
  scanSnapshot({
    events: input.events,
    eventCount: input.eventCount,
    visit: (event) => {
      if (!relatedRunIds.has(event.runId)) return;
      traceEvents.push(event);
      if (traceEvents.length > maximumDeliberationTraceEvents) {
        throw Object.assign(new Error("The deliberation trace contains more than 1,000 events."), {
          code: "deliberation_trace_too_large",
        });
      }
    },
  });
  return { started, artifacts, failedPublications, completed, traceEvents };
}
