import { projectWorkExecutionReport } from "@lervo/execution-observability";
import { collectProjectEventsBounded, type EventStore } from "@lervo/storage-contract";
import type { WorkExecutionReport } from "@lervo/schemas";

import { DiagnosticsError } from "./types.js";

export const maximumWorkTraceEvents = 100_000;

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
    events = collectProjectEventsBounded({
      events: input.events,
      maximumEvents: maximumWorkTraceEvents,
    });
  } catch (error) {
    throw new DiagnosticsError(
      "trace_result_too_large",
      `The work trace source exceeds ${maximumWorkTraceEvents} events.`,
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
      );
    }
    throw error;
  }
}
