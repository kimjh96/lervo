import type { LocalImprovementObservationReportV1 } from "./improvement-observation-collection.js";

function formatRate(numerator: number, denominator: number): string {
  return `${((numerator / denominator) * 100).toFixed(2)}%`;
}

export function formatLocalImprovementObservationReport(
  report: LocalImprovementObservationReportV1,
): string {
  const observations = report.observations.map(
    (item) =>
      `  ${item.metricId}: ${item.numerator}/${item.denominator} (${formatRate(item.numerator, item.denominator)})`,
  );
  const unavailable = report.unavailable.map(
    (item) => `  ${item.metricId}: unavailable (${item.reason})`,
  );
  return [
    `Local improvement observation: ${report.phase}; observed ${report.observations.length}, unavailable ${report.unavailable.length}.`,
    ...observations,
    ...unavailable,
    "Attribution is unestablished. No canonical state was changed.",
    "",
  ].join("\n");
}
