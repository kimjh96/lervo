import { deliberationRootCausality } from "@lervo/deliberation-runtime";
import { rootWorkId, workCausalityEventId } from "@lervo/execution-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { EventStore } from "@lervo/storage-contract";
import { describe, expect, it } from "vitest";

import { longHistoryEvents } from "../../storage-contract/test/listed-event-source.fixture.js";

const coordinates = {
  projectId: "prj_deliberation_history",
  runId: "run_deliberation_history",
  sessionId: "ses_deliberation_history",
};
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function event(type: string, payload: Record<string, unknown>, eventId: string): EventEnvelope {
  return {
    eventId,
    projectId: coordinates.projectId,
    runId: coordinates.runId,
    sessionId: coordinates.sessionId,
    seq: 1,
    type,
    occurredAt: "2026-09-21T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: type === "work.causality.recorded" ? 2 : 1,
    policyVersion: hash("a"),
    payload,
    previousHash: null,
    eventHash: hash("b"),
  } as EventEnvelope;
}

const causalityEventId = workCausalityEventId(coordinates.projectId, coordinates.runId);
const recorded = event(
  "work.causality.recorded",
  {
    workId: rootWorkId(coordinates.projectId, coordinates.runId),
    executionContractVersion: 1,
    relationship: "root",
    parentRunId: null,
    retryOfRunId: null,
    attemptOrdinal: 1,
    workstreamId: null,
    assignmentId: null,
    agentId: null,
  },
  causalityEventId,
);

function admit(source: readonly EventEnvelope[]) {
  const resequenced = source.map((item, index) => ({ ...item, seq: index + 1 }));
  return deliberationRootCausality({
    events: { list: longHistoryEvents(resequenced).list } as unknown as EventStore,
    coordinates,
    occurredAt: "2026-09-21T01:00:00.000Z",
  });
}

describe("deliberation root causality history", () => {
  it("admits beyond 100,000 events and replays an existing record idempotently", () => {
    expect(admit([]).spec).toMatchObject({
      eventId: causalityEventId,
      occurredAt: "2026-09-21T01:00:00.000Z",
    });
    expect(admit([recorded]).spec.occurredAt).toBe(recorded.occurredAt);
  });

  it("still rejects an already-started deliberation and conflicting ancestry", () => {
    expect(() =>
      admit([recorded, event("deliberation.started", {}, "evt_deliberation_started")]),
    ).toThrowError(expect.objectContaining({ code: "causality_run_already_started" }));
    expect(() => admit([{ ...recorded, eventId: "evt_other_causality_record" }])).toThrowError(
      expect.objectContaining({ code: "causality_conflict" }),
    );
  });
});
