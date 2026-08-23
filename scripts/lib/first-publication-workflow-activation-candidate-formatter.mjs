const messages = Object.freeze({
  review_required: "review required",
});

export function formatFirstPublicationWorkflowActivationCandidate(candidate) {
  const lines = [
    `CLI first-publication workflow activation candidate: ${messages[candidate.status] ?? "confirmation required"}`,
    "- Adds one publish-cli job while preserving all other existing release-workflow content.",
    "- The new job receives verified release files and performs stage-only publishing in the npm-release environment.",
    "- Direct publication is prohibited, and no registry token is added to the workflow.",
    "- This is a review candidate and cannot yet be applied to the source workflow.",
    "Use --workflow-yaml for the exact candidate file and --json for review metadata.",
    "No files, npm or GitHub settings, or package state were changed.",
  ];
  return `${lines.join("\n")}\n`;
}
