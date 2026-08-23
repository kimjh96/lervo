export function formatFirstPublicationStageResultEvidence(report) {
  return [
    "CLI npm stage result evidence: verified",
    `- Target: ${report.target.package}@${report.target.version}`,
    `- workflow run ID: ${report.target.runId}, attempt ${report.target.attempt}`,
    "- Artifact: full archive digest and embedded attempt and terminal documents verified",
    "- Stage result: records that npm CLI completed the stage request with exit code 0",
    "- Caution: this is not independent registry acceptance evidence or 2FA approval",
    "- Public status: not checked",
    "- Changes: none beyond read-only artifact download",
    "",
  ].join("\n");
}
