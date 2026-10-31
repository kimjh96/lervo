import type { TerminalCoverageReport } from "@lervo/diagnostics";

export function formatTerminalCoverageReport(report: TerminalCoverageReport): string {
  if (report.reports.length === 0) {
    return "No unmanaged terminal context observations were found.\n";
  }
  const lines = report.reports.map((item) => {
    const referenced =
      item.coverage.explicitReference.value === null
        ? item.coverage.explicitReference.reason
        : `${item.coverage.explicitReference.numerator}/${item.coverage.explicitReference.denominator}`;
    const queryProjection =
      item.resources.queryProjection.usage === null
        ? item.resources.queryProjection.reasonCode
        : `${item.resources.queryProjection.usage.totalTokens} tokens (${item.resources.queryProjection.status}: ${item.resources.queryProjection.reasonCode})`;
    const timing =
      item.stages.observations.length === 0
        ? item.stages.missingReasons.join(",")
        : item.stages.observations
            .map((observation) => {
              const total = observation.stages.find((stage) => stage.stageId === "total");
              return `${observation.hookEvent}=${total?.durationMs ?? "unknown"}ms`;
            })
            .join(",");
    return [
      `  ${item.provider} ${item.occurredAt}: prepared=${item.documents.length}`,
      `referenced=${referenced}`,
      `selected=${item.selectedCount ?? "unobserved"}`,
      `references=${item.referenceCount ?? "unobserved"}`,
      `path-mentions=${item.pathMentionCount ?? "unobserved"} (proxy)`,
      `completion=${item.completion.result}`,
      `whole-task=${item.resources.wholeTask.reasonCode}`,
      `query-projection=${queryProjection}`,
      `timing=${timing}`,
    ].join("; ");
  });
  return [
    `Unmanaged terminal context observations: ${report.reports.length}`,
    ...lines,
    "Managed delivery and internal use remain unsupported for direct provider execution.",
    "Path mentions are a reference proxy; they do not prove reading or reliance.",
    "Provider-reported usage is not billed cost.",
    "",
  ].join("\n");
}
