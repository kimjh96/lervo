import { projectWorkExecutionReport } from "@lervo/execution-observability";
import {
  EventReadError,
  visitEventsOfTypes,
  visitRunEvents,
  type EventStore,
} from "@lervo/storage-contract";
import type { EventEnvelope, WorkExecutionReport } from "@lervo/schemas";

import { DiagnosticsError } from "./types.js";

/** Bounds the events a work trace retains, never the length of project history. */
export const maximumWorkTraceEvents = 100_000;

function causalWorkId(event: EventEnvelope): unknown {
  return (event.payload as { workId?: unknown }).workId;
}

/**
 * Reads exactly the history `projectWorkExecutionReport` consumes for one work: every causal
 * record, so ancestry conflicts anywhere still fail closed, and every event of the work's runs.
 * Events after `throughSeq` are excluded so a caller can bind the result to a verified head.
 */
export function collectWorkExecutionEvents(input: {
  events: Pick<EventStore, "list"> & Partial<Pick<EventStore, "latest">>;
  workId: string;
  maximumEvents?: number;
  /** The verified head to read through; without it, the store's head at the start of the read. */
  throughSeq?: number;
}): EventEnvelope[] {
  const maximumEvents = input.maximumEvents ?? maximumWorkTraceEvents;
  // One head for every read, so a run created after the causal read cannot be half observed.
  if (input.throughSeq === undefined && input.events.latest === undefined)
    throw new TypeError("A work trace needs a head: throughSeq or an event store with latest().");
  const throughSeq = input.throughSeq ?? input.events.latest!()?.seq ?? 0;
  const causality: EventEnvelope[] = [];
  visitEventsOfTypes({
    events: input.events,
    types: ["work.causality.recorded"],
    throughSeq,
    visit: (event) => {
      // The bound counts only retained events inside the snapshot.
      if (causality.length >= maximumEvents)
        throw new EventReadError(
          "event_limit_exceeded",
          `Work events exceed the allowed limit of ${maximumEvents}.`,
        );
      causality.push(event);
    },
  });
  const runIds = [
    ...new Set(
      causality.filter((event) => causalWorkId(event) === input.workId).map((event) => event.runId),
    ),
  ];
  // A run read returns the causal record already held, so only new sequences count.
  const bySequence = new Map(causality.map((event) => [event.seq, event]));
  for (const runId of runIds) {
    visitRunEvents({
      events: input.events,
      runId,
      throughSeq,
      visit: (event) => {
        if (bySequence.has(event.seq)) return;
        if (bySequence.size >= maximumEvents) {
          throw new EventReadError(
            "event_limit_exceeded",
            `Work events exceed the allowed limit of ${maximumEvents}.`,
          );
        }
        bySequence.set(event.seq, event);
      },
    });
  }
  return [...bySequence.values()].sort((left, right) => left.seq - right.seq);
}

export function createWorkExecutionReport(input: {
  projectId: string;
  events: EventStore;
  workId: string;
}): WorkExecutionReport {
  if (!/^wrk_[a-f0-9]{24}$/.test(input.workId)) {
    throw new DiagnosticsError("trace_work_not_found", "The requested work ID is invalid.");
  }
  let events;
  try {
    events = collectWorkExecutionEvents({ events: input.events, workId: input.workId });
  } catch (error) {
    throw new DiagnosticsError(
      "trace_result_too_large",
      `The work trace source exceeds ${maximumWorkTraceEvents} retained events or could not be read.`,
      { cause: error instanceof Error ? error : undefined },
    );
  }
  try {
    return projectWorkExecutionReport({
      projectId: input.projectId,
      workId: input.workId,
      events,
    });
  } catch (error) {
    const code = (error as { code?: unknown })?.code;
    if (code === "work_not_found") {
      throw new DiagnosticsError(
        "trace_work_not_found",
        `There are no events for the requested work ID: ${input.workId}`,
        { cause: error },
      );
    }
    throw error;
  }
}
