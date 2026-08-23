export function formatFirstPublicationWorkflowReachabilityEvidence(report) {
  return [
    "CLI stage-only workflow ref reachability verified",
    `- The source commit is contained in the current default branch, ${report.github.defaultBranch.name}.`,
    `- Release tag ${report.target.releaseTag} points exactly to the same source commit.`,
    "- The default-branch and tag refs did not move during observation.",
    "",
    "This result does not guarantee that refs remain unchanged after observation.",
    "Workflow execution, npm stage acceptance, 2FA approval, and public package availability were not verified.",
    "No local files, GitHub settings, or Git refs were changed.",
  ].join("\n") + "\n";
}
