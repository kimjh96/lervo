export function formatFirstPublicationWorkflowActivationPostApplyReport() {
  return [
    "CLI stage-only workflow post-apply verification complete",
    "- The current workflow file matches the result recorded in the apply receipt.",
    "- The stage-publish command and workflow permissions and execution conditions remain constrained.",
    "- npm stage permissions and GitHub review and tag-protection settings were rechecked.",
    "",
    "This verification does not validate the apply receipt issuer or signature, or the full history of the reviewed candidate.",
    "It also does not establish that the workflow was deployed or run on GitHub, or that npm accepted a stage or made the package public.",
    "No files, workflows, npm or GitHub settings, or package state were changed.",
  ].join("\n") + "\n";
}
