import type { EventEnvelope } from "@lervo/schemas";
import type { OutboxStore } from "@lervo/storage-contract";
import type {
  KnowledgeConvergenceHost,
  KnowledgeConvergenceStatus,
} from "./knowledge-convergence-contract.js";
import { convergenceRetryLimit } from "./knowledge-convergence-failure.js";
import {
  replayKnowledgeConvergence,
  type KnowledgeConvergenceProjection,
} from "./knowledge-convergence-replay.js";

export function convergenceStatus(
  input: { events: OutboxStore },
  baseline: Awaited<ReturnType<KnowledgeConvergenceHost["discover"]>>,
  now: Date,
  transport: KnowledgeConvergenceStatus["transport"],
  rows: readonly KnowledgeConvergenceProjection[] = replayKnowledgeConvergence(input.events),
): KnowledgeConvergenceStatus {
  const active = rows.filter((row) => row.outcome === null);
  const oldest = active[0];
  const latestCurrent = rows.findLast(
    (row) => row.outcome?.payload.terminalState === "current",
  )?.outcome;
  const row: KnowledgeConvergenceProjection | undefined = oldest;
  const event: EventEnvelope | undefined = row?.latest ?? row?.baseline;
  const delivery =
    event === undefined ? null : input.events.getOutbox(event.eventId, "knowledge:convergence");
  const state: KnowledgeConvergenceStatus["state"] =
    row === undefined
      ? "idle"
      : delivery?.status === "leased" && Date.parse(delivery.lease?.expiresAt ?? "") > now.getTime()
        ? "running"
        : delivery?.lastFailure !== null && delivery?.lastFailure !== undefined
          ? "retry_scheduled"
          : (row.latest?.payload.state ?? "queued");
  return {
    transport,
    debtCounts: baseline.debtCounts,
    outstanding: active.length,
    oldestAgeMilliseconds:
      oldest === undefined
        ? null
        : Math.max(0, now.getTime() - Date.parse(oldest.baseline.occurredAt)),
    activeStage: row === undefined ? null : (row.latest?.payload.stage ?? "assessment"),
    state,
    reason:
      delivery?.lastFailure?.code ??
      (event?.payload.failureCode as string | null | undefined) ??
      null,
    ...(state === "retry_scheduled" && delivery !== null
      ? {
          retry: {
            attemptCount: delivery.attemptCount,
            attemptLimit: convergenceRetryLimit(delivery.lastFailure!.code),
            nextAttemptAt: delivery.availableAt,
          },
        }
      : {}),
    lastVerifiedCurrency:
      latestCurrent === undefined || latestCurrent === null
        ? null
        : {
            obligationId: latestCurrent.payload.obligationId,
            snapshotHash: latestCurrent.payload.snapshotHash,
            resolvedAt: latestCurrent.payload.resolvedAt,
          },
  };
}
