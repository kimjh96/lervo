import type { OperatingObjectiveReportV1 } from "@lervo/application-contract";

import type { OperatingBudgetGroupV1 } from "./types.js";

export function formatOperatingObjective(report: OperatingObjectiveReportV1): string {
  const lines = [
    `${report.title} (${report.status})`,
    `workstream: ${report.workstreamId} · revision ${report.workstreamRevision}`,
    `objective: ${report.objective}`,
    "next actions:",
    ...(report.nextActions.length === 0
      ? ["  none"]
      : report.nextActions.map((action) => `  - ${action}`)),
    "blockers:",
    ...(report.blockers.length === 0
      ? ["  none"]
      : report.blockers.map((blocker) => `  - ${blocker}`)),
    `pending: ${report.pendingDecisions.length} decisions · ${report.pendingApprovals.length} approvals`,
  ];
  return `${lines.join("\n")}\n`;
}

export function formatObservedBudgets(groups: OperatingBudgetGroupV1[]): string {
  if (groups.length === 0) return "No exact managed execution budget is configured.\n";
  const lines = [
    "Managed execution budgets:",
    ...groups.map((group) =>
      group.kind === "token"
        ? `  token ${group.provider}/${group.scope ?? "unscoped"}/${group.metric}/${group.accountingDescriptorHash}: observed=${group.observedTokens ?? "unknown"} limit=${group.limitTokens} remaining=${group.remainingObservedTokens ?? "unknown"} evidence=${group.completeness} threshold=${group.thresholdState}`
        : `  duration ${group.provider}/${group.scope}/${group.stageId}: maximum=${group.maximumObservedDurationMs ?? "unknown"}ms limit=${group.limitDurationMs}ms remaining=${group.remainingObservedDurationMs ?? "unknown"}ms observations=${group.observationCount} evidence=${group.completeness} threshold=${group.thresholdState}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}
