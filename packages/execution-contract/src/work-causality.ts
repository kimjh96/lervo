import { createHash } from "node:crypto";

import {
  validateSchema,
  type EventEnvelope,
  type WorkCausalityRecordedEventPayload,
} from "@lervo/schemas";

export type WorkCausalityErrorCode =
  | "causality_invalid"
  | "causality_conflict"
  | "causality_parent_missing"
  | "causality_work_escape"
  | "causality_cycle"
  | "causality_retry_invalid"
  | "causality_root_conflict"
  | "causality_run_already_started";

export class WorkCausalityError extends Error {
  constructor(
    readonly code: WorkCausalityErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkCausalityError";
  }
}

export interface WorkCausalityRecord {
  eventId: string;
  runId: string;
  payload: WorkCausalityRecordedEventPayload;
}

export type RunCausalityProjection =
  { status: "linked"; record: WorkCausalityRecord } | { status: "legacy_unlinked"; runId: string };

function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export function rootWorkId(projectId: string, runId: string): string {
  return `wrk_${shortDigest(`lervo-work-v1\u0000${projectId}\u0000${runId}`)}`;
}

export function workCausalityEventId(projectId: string, runId: string): string {
  return `evt_causality_${shortDigest(`lervo-causality-v1\u0000${projectId}\u0000${runId}`)}`;
}

function fail(code: WorkCausalityErrorCode, message: string): never {
  throw new WorkCausalityError(code, message);
}

function payloadKey(payload: WorkCausalityRecordedEventPayload): string {
  return JSON.stringify({
    workId: payload.workId,
    executionContractVersion: payload.executionContractVersion,
    relationship: payload.relationship,
    parentRunId: payload.parentRunId,
    retryOfRunId: payload.retryOfRunId,
    attemptOrdinal: payload.attemptOrdinal,
    workstreamId: payload.workstreamId,
    assignmentId: payload.assignmentId,
    agentId: payload.agentId,
  });
}

export function sameWorkCausality(
  left: WorkCausalityRecordedEventPayload,
  right: WorkCausalityRecordedEventPayload,
): boolean {
  return payloadKey(left) === payloadKey(right);
}

export function readWorkCausalityRecord(event: EventEnvelope): WorkCausalityRecord | null {
  if (event.type !== "work.causality.recorded") return null;
  if (event.schemaVersion !== 2) {
    fail("causality_invalid", "A work causality event must use event schema version 2.");
  }
  const validation = validateSchema("workCausalityRecordedEventPayload", event.payload);
  if (!validation.valid) {
    fail("causality_invalid", "A work causality event payload does not satisfy its schema.");
  }
  return {
    eventId: event.eventId,
    runId: event.runId,
    payload: structuredClone(event.payload as WorkCausalityRecordedEventPayload),
  };
}

export function validateWorkCausalityHistory(
  events: readonly EventEnvelope[],
): ReadonlyMap<string, WorkCausalityRecord> {
  const records = events
    .map(readWorkCausalityRecord)
    .filter((record): record is WorkCausalityRecord => record !== null);
  const byRun = new Map<string, WorkCausalityRecord>();
  const rootByWork = new Map<string, WorkCausalityRecord>();
  for (const record of records) {
    if (byRun.has(record.runId)) {
      fail("causality_conflict", `Run ${record.runId} has more than one causal record.`);
    }
    byRun.set(record.runId, record);
    if (record.payload.relationship === "root") {
      if (rootByWork.has(record.payload.workId)) {
        fail(
          "causality_root_conflict",
          `Work ${record.payload.workId} has more than one causal root.`,
        );
      }
      rootByWork.set(record.payload.workId, record);
    }
  }
  for (const record of records) {
    const { payload } = record;
    if (payload.relationship === "root") continue;
    const parent = byRun.get(payload.parentRunId!);
    if (parent === undefined) {
      fail("causality_parent_missing", `Run ${record.runId} has no recorded causal parent.`);
    }
    if (parent.payload.workId !== payload.workId) {
      fail("causality_work_escape", `Run ${record.runId} escapes its parent's work tree.`);
    }
    if (payload.relationship === "retry") {
      const retried = byRun.get(payload.retryOfRunId!);
      if (
        retried === undefined ||
        retried.payload.workId !== payload.workId ||
        payload.attemptOrdinal !== retried.payload.attemptOrdinal + 1
      ) {
        fail("causality_retry_invalid", `Run ${record.runId} has invalid retry ancestry.`);
      }
    }
  }
  for (const record of records) {
    const visited = new Set<string>();
    let current: WorkCausalityRecord | undefined = record;
    while (current !== undefined && current.payload.parentRunId !== null) {
      if (visited.has(current.runId)) {
        fail("causality_cycle", `Run ${record.runId} belongs to a cyclic work tree.`);
      }
      visited.add(current.runId);
      current = byRun.get(current.payload.parentRunId);
    }
  }
  return byRun;
}

export function validateWorkCausalityAdmission(input: {
  events: readonly EventEnvelope[];
  runId: string;
  eventId: string;
  payload: WorkCausalityRecordedEventPayload;
}): "append" | "idempotent" {
  const validation = validateSchema("workCausalityRecordedEventPayload", input.payload);
  if (!validation.valid) fail("causality_invalid", "The requested causal record is invalid.");
  const byRun = validateWorkCausalityHistory(input.events);
  const existing = byRun.get(input.runId);
  if (existing !== undefined) {
    if (existing.eventId !== input.eventId || !sameWorkCausality(existing.payload, input.payload)) {
      fail("causality_conflict", `Run ${input.runId} is bound to different causal ancestry.`);
    }
    if (
      input.events.some((event) => event.runId === input.runId && event.type === "run.requested")
    ) {
      fail("causality_run_already_started", `Run ${input.runId} has already been admitted.`);
    }
    return "idempotent";
  }
  const candidate = {
    eventId: input.eventId,
    projectId: input.events[0]?.projectId ?? "prj_causality_validation",
    runId: input.runId,
    sessionId: input.events[0]?.sessionId ?? "ses_causality_validation",
    seq: input.events.length + 1,
    type: "work.causality.recorded",
    occurredAt: "2026-01-01T00:00:00.000Z",
    actor: { kind: "system" },
    schemaVersion: 2,
    policyVersion: `sha256:${"0".repeat(64)}`,
    payload: input.payload,
    previousHash: input.events.length === 0 ? null : `sha256:${"0".repeat(64)}`,
    eventHash: `sha256:${"0".repeat(64)}`,
  } as EventEnvelope;
  validateWorkCausalityHistory([...input.events, candidate]);
  return "append";
}

export function projectRunCausality(events: readonly EventEnvelope[]): RunCausalityProjection[] {
  const byRun = validateWorkCausalityHistory(events);
  return [
    ...new Set(
      events.filter((event) => event.type === "run.requested").map((event) => event.runId),
    ),
  ]
    .sort()
    .map((runId) => {
      const record = byRun.get(runId);
      return record === undefined
        ? { status: "legacy_unlinked" as const, runId }
        : { status: "linked" as const, record: structuredClone(record) };
    });
}
