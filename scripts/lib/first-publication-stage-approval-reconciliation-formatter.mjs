export function formatFirstPublicationStageApprovalReconciliation(report) {
  const outcomes = {
    public_release_confirmed: "Exact public release and stage removal confirmed",
    approval_not_confirmed: "No public release is visible and the approval-target stage remains",
    unknown: "Public release and stage state do not support a consistent conclusion",
  };
  return [
    "CLI npm stage approval result reconciliation complete",
    `- Target: ${report.target.package}@${report.target.version}`,
    `- Outcome: ${outcomes[report.outcome]}`,
    "- Retry authorization: none",
    "- Changes: no attempt, terminal, or npm stage state was modified",
    "",
  ].join("\n");
}
