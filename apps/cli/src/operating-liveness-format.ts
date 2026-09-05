import type { OperatingLivenessReportV1 } from "@lervo/application-contract";

export function formatOperatingLiveness(report: OperatingLivenessReportV1): string {
  return [
    `Operating liveness observed at ${report.observedAt}`,
    `root agents: ${report.summary.rootAgentCount}`,
    ...report.rootAgents.items.map(
      (item) =>
        `  ${item.agentId} · ${item.agentStatus} · ${item.status}${item.ageMs === null ? "" : ` · age ${item.ageMs}ms`}`,
    ),
    `managed provider sessions: ${report.summary.managedProviderSessionCount}`,
    ...report.managedProviderProcesses.items.map(
      (item) =>
        `  ${item.adapterId} · ${item.status} · ${item.evidence} · ${item.phase} · point in time`,
    ),
    ...(report.managedProviderProcesses.truncatedCount === 0
      ? []
      : [`  omitted: ${report.managedProviderProcesses.truncatedCount}`]),
    "",
  ].join("\n");
}
