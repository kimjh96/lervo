import type { GovernedWorkReportV1 } from "@lervo/application-contract";
import { planGovernedCompletionReconciliation } from "@lervo/work-controller";

import type { ParsedLoopOptions } from "./loop-options.js";
import type { CliServices } from "./types.js";

type ReconcileOptions = Extract<ParsedLoopOptions, { action: "reconcile" }>;

export type GovernedCompletionReconciliationResult =
  | { status: "planned"; commandId: string; assignmentId: string }
  | { status: "applied"; commandId: string; assignmentId: string };

export async function executeCompletionReconciliation(
  options: ReconcileOptions,
  report: GovernedWorkReportV1,
  services: CliServices,
): Promise<GovernedCompletionReconciliationResult> {
  const command = planGovernedCompletionReconciliation({
    report,
    assignmentId: options.assignmentId,
  });
  if (options.apply === undefined) {
    return { status: "planned", commandId: command.commandId, assignmentId: command.assignmentId };
  }
  if (!options.write || options.apply !== command.commandId) {
    throw new Error("Completion reconciliation apply requires the exact plan ID and --write.");
  }
  const refreshed = await services.inspectGovernedWork({
    repositoryRoot: options.repositoryRoot,
    policy: options.policy,
  });
  const current = planGovernedCompletionReconciliation({
    report: refreshed,
    assignmentId: options.assignmentId,
  });
  if (
    current.commandId !== command.commandId ||
    current.expectedGraphHash !== command.expectedGraphHash
  ) {
    throw new Error("The completion reconciliation plan became stale before apply.");
  }
  await services.reconcileGovernedAssignment({
    repositoryRoot: options.repositoryRoot,
    command: current,
  });
  return { status: "applied", commandId: current.commandId, assignmentId: current.assignmentId };
}
