import { validateWorkCausalityHistory } from "@lervo/execution-contract";
import type { EventEnvelope } from "@lervo/schemas";

export interface WorkstreamCausalScope {
  events: readonly EventEnvelope[];
  workstreamId: string;
  scopeAnchor?: { eventId: string; eventHash: string } | undefined;
}

/** Selects complete causal trees; an anchor never truncates descendants within a selected tree. */
export function selectWorkstreamCausalRuns(input: WorkstreamCausalScope) {
  const causality = [...validateWorkCausalityHistory(input.events).values()];
  const sequences = new Map(input.events.map((event) => [event.eventId, event.seq]));
  const anchor =
    input.scopeAnchor === undefined
      ? undefined
      : input.events.find((event) => event.eventId === input.scopeAnchor!.eventId);
  if (
    input.scopeAnchor !== undefined &&
    (anchor?.eventHash !== input.scopeAnchor.eventHash ||
      anchor.type !== "workstream.snapshot.recorded" ||
      anchor.payload.workstreamId !== input.workstreamId)
  )
    throw new Error("The work resource scope anchor is unavailable or changed.");
  const roots = new Map(
    causality
      .filter((record) => record.payload.relationship === "root")
      .map((record) => [record.payload.workId, record]),
  );
  const workIds = new Set(
    causality
      .filter(
        (record) =>
          record.payload.workstreamId === input.workstreamId &&
          (anchor === undefined ||
            sequences.get(roots.get(record.payload.workId)!.eventId)! > anchor.seq),
      )
      .map((record) => record.payload.workId),
  );
  return causality.filter((record) => workIds.has(record.payload.workId));
}
