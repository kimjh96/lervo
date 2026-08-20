import {
  canonicalJson,
  computeEventHash,
  eventWithoutHash,
  sanitizeEventPayload,
} from "@lervo/event-contract";

import type { TraceReport } from "./types.js";

function expectedTraceStatus(events: TraceReport["events"]): TraceReport["status"] {
  const types = new Set(events.map((event) => event.type));
  if (types.has("run.failed")) return "failed";
  if (types.has("run.completed") || types.has("deliberation.completed")) return "completed";
  return "incomplete";
}

export function isTraceReportSemanticallyValid(report: TraceReport): boolean {
  const { events } = report;
  if (!areTraceEventsValid(events, report.projectId, report.runId)) return false;
  const last = events.at(-1)!;
  if (
    report.integrity.eventCount < last.seq ||
    (report.integrity.eventCount === last.seq && report.integrity.headHash !== last.eventHash)
  ) {
    return false;
  }
  const sessionIds = [...new Set(events.map((event) => event.sessionId))];
  return report.status === expectedTraceStatus(events) &&
    report.firstOccurredAt === events[0]!.occurredAt &&
    report.lastOccurredAt === last.occurredAt &&
    report.sessionIds.length === sessionIds.length &&
    report.sessionIds.every((sessionId, index) => sessionId === sessionIds[index]);
}

export function areTraceEventsValid(
  events: TraceReport["events"],
  projectId: string,
  runId: string,
): boolean {
  try {
    if (events.some((event) => {
      const sanitized = sanitizeEventPayload(event.type, event.payload);
      return event.projectId !== projectId ||
        event.runId !== runId ||
        event.eventHash !== computeEventHash(eventWithoutHash(event)) ||
        sanitized.redactions.length !== 0 ||
        canonicalJson(sanitized.payload) !== canonicalJson(event.payload);
    })) {
      return false;
    }
  } catch {
    return false;
  }
  for (let index = 1; index < events.length; index += 1) {
    const previous = events[index - 1]!;
    const current = events[index]!;
    if (current.seq <= previous.seq) return false;
    if (current.seq === previous.seq + 1 && current.previousHash !== previous.eventHash) {
      return false;
    }
  }
  return true;
}
