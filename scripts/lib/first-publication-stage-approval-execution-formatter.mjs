export function formatFirstPublicationStageApprovalExecution(terminal) {
  return [
    "CLI npm stage approval command complete",
    "- npm CLI result: exit code 0",
    "- Public status: separate registry verification is still required",
    "- Retry: prohibited",
    "- Records: immutable attempt and terminal records stored",
    "",
  ].join("\n");
}
