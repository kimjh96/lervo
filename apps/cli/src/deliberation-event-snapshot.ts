import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";

export const maximumDeliberationTraceEvents = 1_000;

export interface DeliberationEventSnapshot {
  started: EventEnvelope[];
  artifacts: EventEnvelope[];
  completed: EventEnvelope[];
  traceEvents: EventEnvelope[];
}

function scanSnapshot(input: {
  events: Pick<EventStore, "list">;
  eventCount: number;
  visit(event: EventEnvelope): void;
}): void {
  let afterSeq = 0;
  while (afterSeq < input.eventCount) {
    const page = input.events.list({
      afterSeq,
      limit: Math.min(1_000, input.eventCount - afterSeq),
    });
    const snapshotPage = page.filter((event) => event.seq <= input.eventCount);
    const next = snapshotPage.at(-1)?.seq;
    if (next === undefined || next <= afterSeq || next > input.eventCount) {
      throw Object.assign(new Error("숙의 진단 event snapshot을 끝까지 읽지 못했습니다."), {
        code: "deliberation_history_invalid",
      });
    }
    snapshotPage.forEach(input.visit);
    afterSeq = next;
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
    throw new TypeError("숙의 진단 event snapshot 크기가 유효하지 않습니다.");
  }
  const started: EventEnvelope[] = [];
  const artifacts: EventEnvelope[] = [];
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
      if (event.type === "deliberation.started" &&
        event.payload.deliberationId === input.deliberationId) started.push(event);
      if (event.type === "deliberation.artifact.recorded" &&
        event.payload.deliberationId === input.deliberationId) artifacts.push(event);
      if (event.type === "deliberation.completed" &&
        event.payload.deliberationId === input.deliberationId) completed.push(event);
      if (started.length + artifacts.length + completed.length > maximumDeliberationTraceEvents) {
        throw Object.assign(new Error("숙의 추적 event가 1,000개를 넘었습니다."), {
          code: "deliberation_trace_too_large",
        });
      }
    },
  });
  if (matchedCheckpointEventIds.size !== input.checkpointEventIds.size) {
    throw Object.assign(new Error("숙의 checkpoint event가 현재 snapshot과 일치하지 않습니다."), {
      code: "deliberation_history_invalid",
    });
  }
  [...started, ...artifacts, ...completed].forEach((event) => relatedRunIds.add(event.runId));

  const traceEvents: EventEnvelope[] = [];
  scanSnapshot({
    events: input.events,
    eventCount: input.eventCount,
    visit: (event) => {
      if (!relatedRunIds.has(event.runId)) return;
      traceEvents.push(event);
      if (traceEvents.length > maximumDeliberationTraceEvents) {
        throw Object.assign(new Error("숙의 추적 event가 1,000개를 넘었습니다."), {
          code: "deliberation_trace_too_large",
        });
      }
    },
  });
  return { started, artifacts, completed, traceEvents };
}
