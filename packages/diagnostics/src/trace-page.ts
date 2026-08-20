import type { EventStore } from "@lervo/storage-contract";

import { createTraceCursor, decodeTraceCursor } from "./trace-cursor.js";
import {
  readTracePageReport,
  tracePageReportSchemaVersion,
} from "./trace-page-report-contract.js";
import { DiagnosticsError, type TracePageReport, type TraceSelector } from "./types.js";

export const defaultTracePageSize = 50;
export const maximumTracePageSize = 100;

type CreateTracePageInput = {
  projectId: string;
  events: EventStore;
} & (
  | { cursor: string; selector?: never; limit?: never }
  | { cursor?: undefined; selector: TraceSelector; limit?: number }
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
  const candidates = input.events.list({ runId, afterSeq, limit: limit + 1 });
  if (candidates.length === 0) {
    throw new DiagnosticsError(
      cursor === null ? "trace_run_not_found" : "trace_cursor_invalid",
      cursor === null
        ? "요청한 run ID의 event가 없습니다."
        : "trace cursor 뒤에서 다음 event를 찾지 못했습니다.",
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
    events,
  });
}
