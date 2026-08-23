export function formatFirstPublicationWorkflowRemoteDeploymentEvidence() {
  return [
    "CLI stage-only workflow remote source verified",
    "- The specified GitHub commit contains a file identical to the currently verified workflow.",
    "- The remote file preserves the constrained stage-only job contract.",
    "",
    "This result does not establish that the commit is contained in the default branch or a release tag.",
    "Workflow execution, npm stage acceptance, 2FA approval, and public package availability were not verified.",
    "No local files, GitHub settings, or package state were changed.",
  ].join("\n") + "\n";
}
