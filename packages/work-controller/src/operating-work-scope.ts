import type { OperatingMandateV3 } from "@lervo/application-contract";
import { validateWorkCausalityHistory } from "@lervo/execution-contract";
import type { EventEnvelope } from "@lervo/schemas";
import type { AssignmentGraphSourceV1 } from "./graph-projection.js";
import { operatingContractHash } from "./operating-mandate-admission.js";

type Scope = OperatingMandateV3["workScope"];
type Assignment = AssignmentGraphSourceV1 & {
  createdAt: string;
  updatedAt: string;
  handoffs: readonly unknown[];
};

/** Chooses the newest snapshot that the exact work-scope validator can safely admit. */
export function selectOperatingWorkScope<T extends Assignment>(input: {
  projectId: string;
  workstreamId: string;
  events: readonly EventEnvelope[];
  assignments: readonly T[];
}): Scope {
  const anchors = input.events
    .filter(
      (event) =>
        event.type === "workstream.snapshot.recorded" &&
        event.projectId === input.projectId &&
        event.payload.workstreamId === input.workstreamId,
    )
    .sort((left, right) => right.seq - left.seq);
  for (const anchor of anchors) {
    const scope: Scope = {
      schemaVersion: 1,
      workstreamId: input.workstreamId,
      snapshotEventId: anchor.eventId,
      snapshotEventHash: anchor.eventHash,
      excludedAssignments: input.assignments
        .filter(
          (assignment) =>
            assignment.workstreamId === input.workstreamId &&
            Number.isFinite(Date.parse(assignment.createdAt)) &&
            Date.parse(assignment.createdAt) <= Date.parse(anchor.occurredAt),
        )
        .map((assignment) => ({
          assignmentId: assignment.assignmentId,
          contentHash: operatingContractHash(assignment),
        }))
        .sort((left, right) => left.assignmentId.localeCompare(right.assignmentId)),
    };
    try {
      observeOperatingWorkScope({ ...input, scope });
      return scope;
    } catch {
      // An earlier snapshot may precede unresolved work that the current anchor cannot exclude.
    }
  }
  throw new Error("No canonical workstream snapshot can safely anchor the reviewed work scope.");
}

/** Validates an exact reviewed historical boundary without accepting or rewriting prior work. */
export function observeOperatingWorkScope<T extends Assignment>(input: {
  scope: Scope;
  projectId: string;
  workstreamId: string;
  events: readonly EventEnvelope[];
  assignments: readonly T[];
}) {
  const { scope, events, assignments } = input;
  const eventById = new Map(events.map((event) => [event.eventId, event]));
  const assignmentById = new Map(assignments.map((item) => [item.assignmentId, item]));
  const supervised = new Set(
    events
      .filter((event) => event.type === "work.supervision.bound")
      .map((event) => String(event.payload.assignmentId)),
  );
  const anchor = eventById.get(scope.snapshotEventId);
  if (
    scope.workstreamId !== input.workstreamId ||
    anchor?.eventHash !== scope.snapshotEventHash ||
    anchor.type !== "workstream.snapshot.recorded" ||
    anchor.projectId !== input.projectId ||
    anchor.payload.workstreamId !== input.workstreamId
  )
    throw new Error("The reviewed work scope has no exact canonical snapshot anchor.");
  const excluded = new Set(scope.excludedAssignments.map((item) => item.assignmentId));
  for (const pin of scope.excludedAssignments) {
    const assignment = assignmentById.get(pin.assignmentId);
    if (
      assignment === undefined ||
      assignment.projectId !== input.projectId ||
      assignment.workstreamId !== input.workstreamId ||
      !["completed", "failed"].includes(assignment.status) ||
      assignment.lease !== null ||
      assignment.handoffs.length !== 0 ||
      assignment.topology != null ||
      Date.parse(assignment.updatedAt) > Date.parse(anchor.occurredAt) ||
      !Number.isFinite(Date.parse(assignment.updatedAt)) ||
      operatingContractHash(assignment) !== pin.contentHash ||
      supervised.has(pin.assignmentId)
    )
      throw new Error("A historical assignment is changed, active, supervised, or unresolved.");
  }
  for (const assignment of assignments) {
    if (
      assignment.workstreamId === input.workstreamId &&
      ((!excluded.has(assignment.assignmentId) &&
        (!Number.isFinite(Date.parse(assignment.createdAt)) ||
          Date.parse(assignment.createdAt) <= Date.parse(anchor.occurredAt))) ||
        assignment.dependencyIds.some(
          (id) => excluded.has(id) !== excluded.has(assignment.assignmentId),
        ))
    )
      throw new Error(
        "The reviewed work scope omits prior work or crosses its dependency boundary.",
      );
  }
  const causal = [...validateWorkCausalityHistory(events).values()];
  const priorWorkIds = new Set(
    causal
      .filter(
        (record) =>
          record.payload.workstreamId === input.workstreamId &&
          eventById.get(record.eventId)!.seq <= anchor.seq,
      )
      .map((record) => record.payload.workId),
  );
  const eventsByRun = new Map<string, EventEnvelope[]>();
  for (const event of events) {
    const run = eventsByRun.get(event.runId) ?? [];
    run.push(event);
    eventsByRun.set(event.runId, run);
  }
  for (const record of causal.filter((item) => priorWorkIds.has(item.payload.workId))) {
    const run = eventsByRun.get(record.runId)!;
    if (
      !run.some(
        (event) =>
          event.seq <= anchor.seq &&
          ["run.completed", "run.failed", "deliberation.completed"].includes(event.type),
      )
    )
      throw new Error("The reviewed work scope cannot exclude unfinished prior causal work.");
  }
  const pending = new Set<string>();
  for (const event of events) {
    if (event.payload.workstreamId !== input.workstreamId || event.seq > anchor.seq) continue;
    if (event.type === "work.supervision.decision.recorded")
      pending.add(String(event.payload.decisionId));
    if (
      event.type === "work.supervision.decision.superseded" ||
      (event.type === "work.supervision.effect.observed" &&
        event.payload.status === "effect_confirmed")
    )
      pending.delete(String(event.payload.decisionId));
  }
  if (pending.size > 0)
    throw new Error("The reviewed work scope cannot exclude unsettled supervision decisions.");
  return {
    anchor,
    assignments: assignments.filter((item) => !excluded.has(item.assignmentId)),
    historicalAssignments: assignments.filter((item) => excluded.has(item.assignmentId)),
  };
}
