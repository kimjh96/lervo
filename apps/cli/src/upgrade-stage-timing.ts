import type { NodeFleetApplyTiming } from "./node-fleet-apply-contract.js";

/**
 * ADR-0579: the consecutive parts of `lervo upgrade --apply` after admission, in the order they
 * ran. A part covers its stage's inspection, exclusion confirmation, and apply.
 */
export type UpgradeTimedStage =
  | "plan"
  | "capabilities"
  | "workforce"
  | "terminal_integration"
  | "knowledge"
  | "node_inspection"
  | "node"
  | "node_preparation"
  | "node_service"
  | "node_readiness"
  | "node_completion"
  | "knowledge_lint"
  | "event_writer"
  | "host_service"
  | "replica_service"
  | "event_writer_backup_retention"
  | "runtime_retention"
  | "final_plan";

/** One measured part; `ms` is wall time rounded to whole milliseconds. */
export interface UpgradeStageTiming {
  stage: UpgradeTimedStage;
  ms: number;
}

/**
 * Laps one apply into parts that do not overlap, so their sum is the apply's wall time. Each lap
 * ends the previous part; the knowledge stage laps once per generated-only round.
 */
export class UpgradeStageClock {
  readonly timings: UpgradeStageTiming[] = [];
  private last: number;

  constructor(private readonly now: () => number = () => performance.now()) {
    this.last = now();
  }

  lap(stage: UpgradeTimedStage): void {
    const at = this.now();
    this.timings.push({ stage, ms: Math.max(0, Math.round(at - this.last)) });
    this.last = at;
  }

  /**
   * Splits the Node stage into the onboarding's parts. Time the onboarding did not measure, such
   * as preparing a configuration replacement, counts as preparation. Without an onboarding
   * receipt the stage is one part.
   */
  lapNode(timing: NodeFleetApplyTiming | undefined): void {
    if (timing === undefined) {
      this.lap("node");
      return;
    }
    const at = this.now();
    const measured = timing.serviceMs + timing.readinessMs + timing.completionMs;
    const total = Math.max(0, Math.round(at - this.last));
    this.timings.push(
      { stage: "node_preparation", ms: Math.max(0, total - measured) },
      { stage: "node_service", ms: timing.serviceMs },
      { stage: "node_readiness", ms: timing.readinessMs },
      { stage: "node_completion", ms: timing.completionMs },
    );
    this.last = at;
  }
}
