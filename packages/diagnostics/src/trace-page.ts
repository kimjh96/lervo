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
    throw new RangeError(`trace page 크기는 1 이상 ${maximumTracePageSize} 이하여야 합니다.`);
  }
}

export function createTracePage(input: CreateTracePageInput): TracePageReport {
  const integrity = input.events.verifyIntegrity();
  const cursor = input.cursor === undefined ? null : decodeTraceCursor(input.cursor);
  if (input.cursor !== undefined && cursor === null) {
    throw new DiagnosticsError("trace_cursor_invalid", "trace cursor가 올바르지 않습니다.");
  }
  if (cursor !== null && (
    cursor.projectId !== input.projectId ||
    cursor.eventCount !== integrity.eventCount ||
    cursor.headHash !== integrity.headHash
  )) {
    throw new DiagnosticsError(
      "trace_cursor_stale",
      "trace cursor를 만든 뒤 event 원본이 변경되었습니다. 첫 page부터 다시 조회하세요.",
    );
  }

  const latest = input.events.latest();
  if (latest === null) {
    throw new DiagnosticsError("trace_empty", "추적할 로컬 event가 없습니다.");
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
    throw new TypeError("trace event type filter가 올바르지 않습니다.");
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
        ? "trace cursor 뒤에서 다음 event를 찾지 못했습니다."
        : code === "trace_filter_empty"
          ? "요청한 event type에 해당하는 기록이 없습니다."
          : "요청한 run ID의 event가 없습니다.",
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
