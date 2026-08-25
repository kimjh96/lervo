export function formatFirstPublicationWorkflowActivationApply(result) {
  if (result.status === "rolled_back") {
    return "Restored the original CLI stage-only workflow after an interrupted apply.\n";
  }
  if (result.status === "committed_cleanup_completed") {
    return "Removed the recovery record for a completed CLI stage-only workflow apply.\n";
  }
  return (
    [
      "CLI stage-only workflow apply complete",
      "Status: the publish-cli job was activated from the exact reviewed candidate.",
      "npm and GitHub external settings were read only, and no package publication was performed.",
    ].join("\n") + "\n"
  );
}
