import type { GovernedAttemptCommandV1, GovernedWorkReportV1 } from "@lervo/application-contract";

import { shortId } from "./hash.js";

export function planGovernedAttemptCommand(input: {
  report: GovernedWorkReportV1;
  assignmentId: string;
}): GovernedAttemptCommandV1 {
  const action = input.report.decision.actions.find(
    (candidate) =>
      candidate.assignmentId === input.assignmentId &&
      (candidate.kind === "start_attempt" || candidate.kind === "retry_attempt"),
  );
  if (
    action === undefined ||
    (action.kind !== "start_attempt" && action.kind !== "retry_attempt")
  ) {
    throw new TypeError(`Assignment ${input.assignmentId} is not ready for a governed attempt.`);
  }
  const commandBody = {
    schemaVersion: 1 as const,
    kind: "governed_attempt.execute" as const,
    projectId: input.report.projectId,
    workstreamId: input.report.workstreamId,
    expectedGraphHash: input.report.graph.graphHash,
    assignmentId: input.assignmentId,
    causality: action.causality,
  };
  return {
    ...commandBody,
    commandId: shortId("gac", commandBody),
  };
}
