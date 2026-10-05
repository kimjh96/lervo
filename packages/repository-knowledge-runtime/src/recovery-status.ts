import type { ProjectStorage } from "@lervo/project-storage";
import {
  replayKnowledgeConvergence,
  type KnowledgeConvergenceStatus,
} from "@lervo/repository-knowledge";

import { KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND } from "./materialization-transaction.js";

/**
 * A durable apply journal owns recovery before a stable full scan exists; unknown debt is never
 * zero. The status names the one owner command that resolves the interrupted journal.
 */
export function convergenceRecoveryStatus(storage: ProjectStorage): KnowledgeConvergenceStatus {
  const rows = replayKnowledgeConvergence(storage.events);
  const active = rows.filter((row) => row.outcome === null);
  const current = rows.findLast((row) => row.outcome?.payload.terminalState === "current")?.outcome;
  return {
    transport:
      (storage.writableEventSchemaVersion ?? 1) < 4 ? "reader_transition_required" : "ready",
    debtCounts: null,
    outstanding: Math.max(1, active.length),
    oldestAgeMilliseconds: active[0]
      ? Math.max(0, Date.now() - Date.parse(active[0].baseline.occurredAt))
      : null,
    activeStage: active[0]?.latest?.payload.stage ?? null,
    state: "recovery_required",
    reason: "knowledge_recovery_required",
    recoveryCommand: KNOWLEDGE_MATERIALIZATION_RECOVERY_COMMAND,
    lastVerifiedCurrency: current
      ? {
          obligationId: current.payload.obligationId,
          snapshotHash: current.payload.snapshotHash,
          resolvedAt: current.payload.resolvedAt,
        }
      : null,
  };
}
