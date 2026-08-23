import type { EventStore } from "@lervo/storage-contract";
import { eventTypes, type EventEnvelope, type EventType } from "@lervo/schemas";

import { createTraceCursor, decodeTraceCursor } from "./trace-cursor.js";
import {
  readTracePageReport,
  tracePageReportSchemaVersion,
} from "./trace-page-report-contract.js";
import { DiagnosticsError, type TracePageReport, type TraceSelector } from "./types.js";

export const defaultTracePageSize = 50;
export const maximumTracePageSize = 100;
const knownEventTypes = new Set<string>(eventTypes);

type CreateTracePageInput = {
  projectId: string;
  events: EventStore;
} & (
  | { cursor: string; selector?: never; limit?: never }
  | {
      cursor?: undefined;
      selector: TraceSelector;
      limit?: number;
      eventTypes?: readonly EventType[];
    }
);

function assertPageSize(limit: number): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > maximumTracePageSize) {
    throw new RangeError(`The trace page size must be between 1 and ${maximumTracePageSize}.`);
  }
}

export function createTracePage(input: CreateTracePageInput): TracePageReport {
  const integrity = input.events.verifyIntegrity();
  const cursor = input.cursor === undefined ? null : decodeTraceCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new DiagnosticsError("trace_cursor_invalid", "The trace cursor is invalid.");
  }
  if (cursor !== null && (
    cursor.projectId !== input.projectId ||
    cursor.eventCount !== integrity.eventCount ||
    cursor.headHash !== integrity.headHash
  )) {
    throw new DiagnosticsError(
      "trace_cursor_stale",
      "The event source changed after the trace cursor was created. Query again from the first page.",
    );
  }

  const latest = input.events.latest();
  if (latest === null) {
    throw new DiagnosticsError("trace_empty", "There are no local events to trace.");
  }
  const selector = input.cursor === undefined ? input.selector : undefined;
  const runId = cursor?.runId ?? (
    selector === undefined || selector === "last" ? latest.runId : selector
  );
  const limit = cursor?.limit ?? input.limit ?? defaultTracePageSize;
  assertPageSize(limit);
  const afterSeq = cursor?.afterSeq ?? 0;
  const afterEventHash = cursor?.afterEventHash ?? null;
  const requestedEventTypes = cursor?.eventTypes ?? (
    input.cursor === undefined ? input.eventTypes : undefined
  );
  const filteredEventTypes = requestedEventTypes === undefined
    ? undefined
    : [...new Set(requestedEventTypes)].sort();
  if (requestedEventTypes !== undefined && (
    filteredEventTypes!.length === 0 ||
    filteredEventTypes!.length !== requestedEventTypes.length ||
    filteredEventTypes!.some((eventType) => !knownEventTypes.has(eventType))
  )) {
    throw new TypeError("The trace event type filter is invalid.");
  }
  const candidates = filteredEventTypes === undefined
    ? input.events.list({ runId, afterSeq, limit: limit + 1 })
    : readFilteredCandidates(input.events, runId, afterSeq, limit, filteredEventTypes);
  if (candidates.length === 0) {
    const code = cursor !== null
      ? "trace_cursor_invalid"
      : filteredEventTypes !== undefined &&
          input.events.list({ runId, limit: 1 }).length > 0
        ? "trace_filter_empty"
        : "trace_run_not_found";
    throw new DiagnosticsError(
      code,
      code === "trace_cursor_invalid"
        ? "No next event was found after the trace cursor."
        : code === "trace_filter_empty"
          ? "There are no records for the requested event type."
          : "There are no events for the requested run ID.",
    );
  }
  const events = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  const last = events.at(-1)!;
  const nextCursor = hasMore
    ? createTraceCursor({
        schemaVersion: 1,
        projectId: input.projectId,
        runId,
        eventCount: integrity.eventCount,
        headHash: integrity.headHash!,
        afterSeq: last.seq,
        afterEventHash: last.eventHash,
        limit,
        ...(filteredEventTypes === undefined ? {} : { eventTypes: filteredEventTypes }),
      })
    : null;

  return readTracePageReport({
    schemaVersion: tracePageReportSchemaVersion,
    projectId: input.projectId,
    runId,
    integrity,
    page: {
      afterSeq,
      afterEventHash,
      limit,
      returnedCount: events.length,
      hasMore,
      nextCursor,
    },
    ...(filteredEventTypes === undefined
      ? {}
      : { filter: { eventTypes: filteredEventTypes } }),
    events,
  });
}

function readFilteredCandidates(
  store: EventStore,
  runId: string,
  afterSeq: number,
  limit: number,
  eventTypes: readonly EventType[],
): EventEnvelope[] {
  const allowed = new Set<EventType>(eventTypes);
  const matches: EventEnvelope[] = [];
  let scanAfterSeq = afterSeq;
  while (matches.length <= limit) {
    const batch = store.list({ runId, afterSeq: scanAfterSeq, limit: 1000 });
    if (batch.length === 0) break;
    for (const event of batch) {
      scanAfterSeq = event.seq;
      if (allowed.has(event.type)) matches.push(event);
      if (matches.length > limit) return matches;
    }
    if (batch.length < 1000) break;
  }
  return matches;
}
