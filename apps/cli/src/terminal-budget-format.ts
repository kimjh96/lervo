import type { TerminalBudgetReport } from "@lervo/diagnostics";

export function formatTerminalBudgetReport(report: TerminalBudgetReport): string {
  const lines = [
    `Lervo unmanaged terminal budget: ${report.disposition}`,
    `Source contexts: ${report.sourceReportCount}; missing hook observations: ${report.missingHookObservationCount}; incomplete hook outcomes: ${report.incompleteHookOutcomeCount}; invalid stage sets: ${report.invalidStageObservationSetCount}`,
    "Whole-task provider usage: unavailable (unmanaged provider work is not observable)",
    "Hook profiles:",
    ...report.hookProfiles.map(
      (profile) =>
        `  ${profile.provider} ${profile.hookEvent} ${profile.repositoryProfile}/${profile.coldState} samples=${profile.sampleCount} p95=${profile.p95DurationMs}ms/${profile.budgetMs}ms max=${profile.maximumDurationMs}ms status=${profile.status}${profile.reasonCodes.length === 0 ? "" : ` reasons=${profile.reasonCodes.join(",")}`}`,
    ),
    "Query projections:",
    ...report.queryProjections.map(
      (assessment) =>
        `  ${assessment.provider} ${assessment.contextEventId}: ${assessment.observedTokens ?? "unobserved"}${assessment.limitTokens === null ? " tokens (no limit)" : `/${assessment.limitTokens} tokens`} status=${assessment.status}${assessment.reasonCode === null ? "" : ` reason=${assessment.reasonCode}`}`,
    ),
    ...(report.reasonCodes.length === 0
      ? []
      : [`Decision reasons: ${report.reasonCodes.join(", ")}`]),
    "",
  ];
  if (report.hookProfiles.length === 0) lines.splice(4, 0, "  No observed hook profiles.");
  if (report.queryProjections.length === 0)
    lines.splice(lines.indexOf("Query projections:") + 1, 0, "  No query projections.");
  return lines.join("\n");
}
