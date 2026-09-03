export function formatFirstPublicationWorkflowActivationPermit(permit) {
  return (
    [
      "CLI stage-only workflow apply permit created",
      `Target: ${permit.target.repository}/${permit.target.workflow}`,
      "Status: Apply is permitted only while the reviewed workflow bytes and external protections remain unchanged.",
      "",
      "This command did not change the workflow, npm or GitHub settings, or package publication state.",
    ].join("\n") + "\n"
  );
}
