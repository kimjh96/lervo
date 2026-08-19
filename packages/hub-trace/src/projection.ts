import {
  assertProjectSyncState,
  type ProjectSyncState,
} from "@lervo/sync-contract";

import { HubTraceError } from "./errors.js";
import {
  type HubProjectTrace,
  type HubProjectTraceSummary,
  type HubRunTrace,
  type HubRunTraceEvent,
  type HubRunTraceSummary,
} from "./types.js";

function validatedState(state: ProjectSyncState): ProjectSyncState {
  try {
    assertProjectSyncState(state);
    return structuredClone(state);
  } catch (error) {
    throw new HubTraceError(
      "source_inconsistent",
      "Hub trace 원본이 project sync 계약과 다릅니다.",
      { cause: error },
    );
  }
}

function groupedRunEvents(state: ProjectSyncState) {
  const grouped = new Map<string, ProjectSyncState["events"]>();
  for (const event of state.events) {
    const events = grouped.get(event.runId) ?? [];
    events.push(event);
    grouped.set(event.runId, events);
  }
  return [...grouped.entries()].sort((left, right) =>
    left[1][0]!.seq - right[1][0]!.seq || left[0].localeCompare(right[0])
  );
}

function runSummary(
  events: ProjectSyncState["events"],
  cursorSeq: number,
): HubRunTraceSummary {
  const first = events[0]!;
  const last = events.at(-1)!;
  const continuousEventCount = events.filter((event) => event.seq <= cursorSeq).length;
  const sessionIds = [...new Set(events.map((event) => event.sessionId))];
  return {
    runId: first.runId,
    sessionIds,
    firstSeq: first.seq,
    lastSeq: last.seq,
    firstOccurredAt: first.occurredAt,
    lastOccurredAt: last.occurredAt,
    eventCount: events.length,
    continuousEventCount,
    bufferedEventCount: events.length - continuousEventCount,
  };
}

function summaryFromValidState(valid: ProjectSyncState): HubProjectTraceSummary {
  const request = valid.registration.request;
  return {
    destinationId: request.destinationId,
    projectId: request.project.projectId,
    projectName: request.project.name,
    registrationId: request.registrationId,
    projectIdentityHash: request.projectIdentityHash,
    projectManifestHash: request.projectManifestHash,
    registeredAt: valid.registration.registeredAt,
    updatedAt: valid.registration.updatedAt,
    cursor: structuredClone(valid.cursor),
    storedEventCount: valid.events.length,
    continuousEventCount: valid.cursor.seq,
    bufferedEventCount: valid.events.length - valid.cursor.seq,
    runCount: new Set(valid.events.map((event) => event.runId)).size,
  };
}

export function projectTraceSummary(state: ProjectSyncState): HubProjectTraceSummary {
  return summaryFromValidState(validatedState(state));
}

export function projectTrace(state: ProjectSyncState): HubProjectTrace {
  const valid = validatedState(state);
  return {
    project: summaryFromValidState(valid),
    runs: groupedRunEvents(valid).map(([, events]) => runSummary(events, valid.cursor.seq)),
  };
}

export function runTrace(state: ProjectSyncState, runId: string): HubRunTrace {
  const valid = validatedState(state);
  const events = valid.events.filter((event) => event.runId === runId);
  if (events.length === 0) {
    throw new HubTraceError("run_not_found", "요청한 Hub run trace가 없습니다.");
  }
  const traceEvents: HubRunTraceEvent[] = events.map((event) => ({
    chainPosition: event.seq <= valid.cursor.seq ? "continuous" : "buffered",
    event: structuredClone(event),
  }));
  return {
    project: summaryFromValidState(valid),
    run: runSummary(events, valid.cursor.seq),
    events: traceEvents,
  };
}
