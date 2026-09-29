import type {
  EventEnvelope,
  RepositoryKnowledgeBaselineRequestedEventPayload,
  RepositoryKnowledgeStageRecordedEventPayload,
  RepositoryKnowledgeConvergenceRecordedEventPayload,
} from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";

import {
  KNOWLEDGE_CONVERGENCE_DESTINATION,
  MAXIMUM_CONVERGENCE_OBLIGATIONS,
} from "./knowledge-convergence-contract.js";

export interface KnowledgeConvergenceProjection {
  baseline: EventEnvelope & { payload: RepositoryKnowledgeBaselineRequestedEventPayload };
  latest: (EventEnvelope & { payload: RepositoryKnowledgeStageRecordedEventPayload }) | null;
  outcome: (EventEnvelope & { payload: RepositoryKnowledgeConvergenceRecordedEventPayload }) | null;
}

/** Paged canonical replay needs no retained acknowledged queue row or mutable cursor. */
export function replayKnowledgeConvergence(events: OutboxStore): KnowledgeConvergenceProjection[] {
  const active = new Map<string, KnowledgeConvergenceProjection>();
  let lastCurrent: KnowledgeConvergenceProjection | null = null;
  let afterSeq = 0;
  for (;;) {
    const page = events.list({ afterSeq, limit: 1_000 });
    if (page.length === 0) break;
    for (const event of page) {
      afterSeq = event.seq;
      if (event.type === "repository.knowledge.baseline.requested") {
        const baseline = event as KnowledgeConvergenceProjection["baseline"];
        if (
          active.has(baseline.payload.obligationId) ||
          active.size >= MAXIMUM_CONVERGENCE_OBLIGATIONS
        )
          throw new Error(
            "Canonical convergence history exceeds or duplicates the active obligation ceiling.",
          );
        active.set(baseline.payload.obligationId, { baseline, latest: null, outcome: null });
      } else if (event.type === "repository.knowledge.stage.recorded") {
        const stage = event as NonNullable<KnowledgeConvergenceProjection["latest"]>;
        const row = active.get(stage.payload.obligationId);
        const predecessor = row?.latest ?? row?.baseline;
        if (
          row === undefined ||
          predecessor === undefined ||
          stage.projectId !== row.baseline.projectId ||
          stage.payload.predecessorEventId !== predecessor.eventId ||
          stage.payload.predecessorEventHash !== predecessor.eventHash
        )
          throw new Error("The convergence stage does not bind its canonical predecessor.");
        row.latest = stage;
      } else if (event.type === "repository.knowledge.convergence.recorded") {
        const outcome = event as NonNullable<KnowledgeConvergenceProjection["outcome"]>;
        const row = active.get(outcome.payload.obligationId);
        if (
          row === undefined ||
          outcome.projectId !== row.baseline.projectId ||
          outcome.payload.originalEventId !== row.baseline.eventId ||
          outcome.payload.originalEventHash !== row.baseline.eventHash
        )
          throw new Error("The convergence outcome does not bind its canonical baseline.");
        if (row !== undefined) {
          row.outcome = outcome;
          if (outcome.payload.terminalState === "current") lastCurrent = row;
          active.delete(outcome.payload.obligationId);
        }
      }
    }
  }
  if (active.size > MAXIMUM_CONVERGENCE_OBLIGATIONS)
    throw new Error("Canonical convergence history exceeds the active obligation ceiling.");
  return [...(lastCurrent === null ? [] : [lastCurrent]), ...active.values()];
}

/** Capacity can delay an obligation, but its canonical source is always replayable. */
export function reconcileKnowledgeConvergenceOutbox(
  events: OutboxStore,
  rows: readonly KnowledgeConvergenceProjection[],
  now: string,
): number {
  let recovered = 0;
  for (const row of rows) {
    if (row.outcome !== null) continue;
    const event = row.latest ?? row.baseline;
    if (row.latest !== null && row.latest.payload.state !== "queued") continue;
    if (events.getOutbox(event.eventId, KNOWLEDGE_CONVERGENCE_DESTINATION) !== null) continue;
    const inserted = events.transact(
      (transaction) =>
        transaction.outstandingCount(KNOWLEDGE_CONVERGENCE_DESTINATION) <
          MAXIMUM_CONVERGENCE_OBLIGATIONS &&
        transaction.enqueue({
          eventId: event.eventId,
          destinationId: KNOWLEDGE_CONVERGENCE_DESTINATION,
          enqueuedAt: now,
        }).inserted,
    );
    if (inserted) recovered++;
    else break;
  }
  return recovered;
}
