import { rootWorkId, workCausalityEventId } from "@lervo/execution-contract";
import { admitManagedWorkCausality, type ManagedEventStore } from "@lervo/orchestrator";
import type { EventEnvelope } from "@lervo/schemas";
import { describe, expect, it } from "vitest";

import { longHistoryEvents } from "../../storage-contract/test/listed-event-source.fixture.js";

const projectId = "prj_admission_history";
const coordinates = {
  projectId,
  runId: "run_admission_child",
  sessionId: "ses_admission_child",
  roleId: "developer",
};
const parentRunId = "run_admission_parent";
const workId = rootWorkId(projectId, parentRunId);
const hash = (value: string) => `sha256:${value.repeat(64)}`;

function event(
  seq: number,
  type: string,
  runId: string,
  payload: Record<string, unknown>,
  eventId = `evt_admission_${seq}`,
): EventEnvelope {
  return {
    eventId,
    projectId,
    runId,
    sessionId: `ses_${runId.slice(4)}`,
    seq,
    type,
    occurredAt: `2026-09-21T00:00:${String(seq).padStart(2, "0")}.000Z`,
    actor: { kind: "system" },
    schemaVersion: type === "work.causality.recorded" ? 2 : 1,
    policyVersion: hash("a"),
    payload,
    previousHash: seq === 1 ? null : hash("b"),
    eventHash: hash("c"),
  } as EventEnvelope;
}

function causality(runId: string, payload: Record<string, unknown>, eventId?: string) {
  return event(
    1,
    "work.causality.recorded",
    runId,
    {
      workId,
      executionContractVersion: 1,
      relationship: "root",
      parentRunId: null,
      retryOfRunId: null,
      attemptOrdinal: 1,
      workstreamId: null,
      assignmentId: null,
      agentId: null,
      ...payload,
    },
    eventId,
  );
}

const parent = causality(parentRunId, {}, workCausalityEventId(projectId, parentRunId));
const request = {
  relationship: "subagent" as const,
  workId,
  parentRunId,
};

function store(source: readonly EventEnvelope[]): ManagedEventStore {
  const resequenced = source.map((item, index) => ({ ...item, seq: index + 1 }));
  return { list: longHistoryEvents(resequenced).list } as unknown as ManagedEventStore;
}

function admit(source: readonly EventEnvelope[]) {
  return admitManagedWorkCausality({
    events: store(source),
    coordinates,
    request,
    occurredAt: "2026-09-21T01:00:00.000Z",
  });
}

describe("managed work causality admission history", () => {
  it("admits a child run beyond 100,000 events from causal records alone", () => {
    expect(admit([parent]).spec).toMatchObject({
      eventId: workCausalityEventId(projectId, coordinates.runId),
      occurredAt: "2026-09-21T01:00:00.000Z",
      payload: { relationship: "subagent", parentRunId, workId },
    });
  });

  it("keeps idempotent, conflicting, missing-parent, and already-started outcomes", () => {
    const eventId = workCausalityEventId(projectId, coordinates.runId);
    const recorded = { ...admit([parent]).spec.payload };
    const existing = causality(coordinates.runId, recorded, eventId);
    expect(admit([parent, existing]).spec.occurredAt).toBe(existing.occurredAt);

    expect(() =>
      admit([parent, causality(coordinates.runId, { ...recorded, attemptOrdinal: 2 }, eventId)]),
    ).toThrowError(expect.objectContaining({ code: "causality_conflict" }));
    expect(() => admit([])).toThrowError(
      expect.objectContaining({ code: "causality_parent_missing" }),
    );
    expect(() =>
      admit([parent, existing, event(3, "run.requested", coordinates.runId, {})]),
    ).toThrowError(expect.objectContaining({ code: "causality_run_already_started" }));
  });
});
