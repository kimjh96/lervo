export function formatFirstPublicationStageReviewEvidence(report) {
  return [
    "CLI npm staged-package review evidence: verified",
    `- Target: ${report.target.package}@${report.target.version}`,
    "- Stage: exactly one item exists for the package and version, and list agrees with view",
    "- Tarball: the downloaded file matches the digest from the prior stage result",
    "- Stability: stage metadata and npm user configuration were rechecked after review",
    "- Privacy: stage ID and npm account information are not stored in the report",
    "- Caution: this does not establish human approval, completed 2FA, or public distribution",
    "- Changes: performed only stage list, view, and download; did not approve or reject",
    "",
  ].join("\n");
}
