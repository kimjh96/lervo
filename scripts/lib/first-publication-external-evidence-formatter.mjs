export function formatFirstPublicationExternalEvidenceReport(report) {
  return [
    "CLI first-publication external-requirements evidence bound",
    `Target: ${report.target.package}@${report.target.version}`,
    "- Revalidated the current package metadata post-apply result.",
    "- Bound a separate license approval document.",
    "- Confirmed that the current package is not visible on public npm.",
    "- Bound a separate npm scope-control confirmation document.",
    "- Bound the complete first-publication approval document.",
    "",
    "This result does not authorize publication execution.",
    "Human identity and npm scope permissions were not verified against an external system.",
    "The npm lookup covers public package results and does not establish the absence of a private package.",
    "No files were modified, and no approvals, publishing activation, or package publication were performed.",
    "",
  ].join("\n");
}
