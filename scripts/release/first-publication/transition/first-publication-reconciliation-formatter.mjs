const outcomeMessages = {
  published: "Approved publication observed on public npm",
  not_observed: "Approved publication not observed on public npm",
  unknown: "The result cannot be determined from public npm data alone",
};

const checkLabels = {
  exact_version: "Exact version and publication artifact",
  target_dist_tag: "Target dist-tag",
};

const statusMessages = {
  matched: "matched",
  not_observed: "not observed",
  unknown: "unknown",
};

const reasonMessages = {
  registry_unavailable: "The public npm response could not be verified safely.",
  target_version_not_observed: "Metadata for the target version is not visible.",
  exact_release_mismatch:
    "The target version exposes metadata that differs from the approved publication artifact.",
  target_dist_tag_not_observed: "The target dist-tag does not point to the approved version.",
};

export function formatFirstPublicationReconciliation(report) {
  const lines = [
    `CLI first-publication reconciliation: ${outcomeMessages[report.outcome] ?? "unknown"}`,
  ];
  for (const check of report.checks) {
    lines.push(
      `- ${checkLabels[check.id] ?? check.id}: ${statusMessages[check.status] ?? "unknown"}`,
    );
    for (const reason of check.reasons) {
      lines.push(`  ${reasonMessages[reason] ?? "The result could not be determined safely."}`);
    }
  }
  lines.push(
    "This report does not change existing reservations or terminal records. It did not retry automatically or mark publication complete regardless of the result.",
  );
  return `${lines.join("\n")}\n`;
}
