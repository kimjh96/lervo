export function formatFirstPublicationWorkflowExecutionEvidence(report) {
  return [
    "CLI stage-only workflow execution evidence: verified",
    `- Target: ${report.target.package}@${report.target.version}`,
    `- release tag: ${report.target.releaseTag}`,
    `- workflow run: #${report.github.run.runNumber}, attempt ${report.target.attempt}`,
    "- Execution result: both the workflow and stage job completed successfully",
    "- Result retention: run-attempt-specific artifact metadata verified",
    "- Not yet verified: artifact contents, npm stage acceptance, 2FA approval, public distribution",
    "- Changes: no files, GitHub settings, workflow execution, or publication state changed",
    "",
  ].join("\n");
}
