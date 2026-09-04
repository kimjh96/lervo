import type { OperatingGoalReportV1 } from "@lervo/application-contract";

export function formatOperatingGoal(report: OperatingGoalReportV1): string {
  return [
    `Lervo operating goal: ${report.completion.status}`,
    `goal: ${report.goal.goalId} revision ${report.goal.revision} (${report.goal.status})`,
    `objective: ${report.goal.objective}`,
    `assignments: ${report.progress.completed}/${report.progress.total} completed; ${report.progress.active} active; ${report.progress.blocked} blocked; ${report.progress.failed} failed`,
    ...(report.completion.reasonCodes.length === 0
      ? []
      : [`reasons: ${report.completion.reasonCodes.join(", ")}`]),
    `authority: projection only; createsGoal=${report.authority.createsGoal}; startsProvider=${report.authority.startsProvider}`,
    "",
  ].join("\n");
}
