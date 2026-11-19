import type { KnowledgeResidentState } from "./resident-health.js";
import type { ResidentCycleOutcome } from "./resident-cycle.js";
import type { ResidentCycleResult } from "./resident-cycle-state.js";
import { nonOwnerHealth } from "./resident-ownership.js";

type WorkerResult = Extract<ResidentCycleOutcome, { kind: "completed" }>["result"];

export interface ResidentHealthReport {
  state: KnowledgeResidentState;
  reason: string | null;
}

function healthOf(result: WorkerResult): KnowledgeResidentState {
  if (result.status === "busy") return "busy";
  if (result.status === "waiting_owner") return nonOwnerHealth(result.owner).state;
  switch (result.convergence.state) {
    case "waiting_authority":
      return "waiting";
    case "attention_required":
    case "recovery_required":
      return "attention";
    default:
      return "idle";
  }
}

/**
 * The resident health one observation reports. A skip repeats the last full cycle's class and
 * keeps its reason while the state is unchanged; `source_unchanged` proves only the skip.
 */
export function residentCycleHealth(
  cycle: { outcome: ResidentCycleOutcome; state: { lastResult: ResidentCycleResult } },
  current: ResidentHealthReport,
): ResidentHealthReport {
  const { outcome } = cycle;
  if (outcome.kind === "failed")
    return { state: "attention", reason: "knowledge_resident_cycle_failed" };
  if (outcome.kind === "completed") {
    const { result } = outcome;
    return {
      state: healthOf(result),
      reason:
        result.status === "processed"
          ? result.convergence.reason
          : result.status === "waiting_owner"
            ? nonOwnerHealth(result.owner).reason
            : (result.reason ?? null),
    };
  }
  // ADR-0595: a held repository keeps reporting the hold while its unchanged fence skips.
  if (cycle.state.lastResult === "held") return { state: "busy", reason: "repository_owner_hold" };
  const state =
    cycle.state.lastResult === "waiting"
      ? "waiting"
      : cycle.state.lastResult === "attention"
        ? "attention"
        : "idle";
  return {
    state,
    reason:
      state !== "idle" && current.state === state && current.reason !== null
        ? current.reason
        : "source_unchanged",
  };
}
