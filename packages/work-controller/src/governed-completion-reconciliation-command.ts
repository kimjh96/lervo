import type {
  GovernedCompletionReconciliationCommandV1,
  GovernedWorkReportV1,
} from "@lervo/application-contract";

import { sha256 } from "./hash.js";

export function planGovernedCompletionReconciliation(input: {
  report: GovernedWorkReportV1;
  assignmentId: string;
}): GovernedCompletionReconciliationCommandV1 {
  const action = input.report.decision.actions.find(
    (candidate) =>
      candidate.kind === "reconcile_completion" && candidate.assignmentId === input.assignmentId,
  );
  if (action === undefined || action.kind !== "reconcile_completion") {
    throw new Error("The assignment is not ready for completion reconciliation.");
  }
  const evidence = input.report.completionEvidence.find(
    (candidate) => candidate.completionEvidenceId === action.completionEvidenceId,
  );
  const node = input.report.graph.nodes.find(
    (candidate) => candidate.assignmentId === input.assignmentId,
  );
  if (
    evidence === undefined ||
    node === undefined ||
    evidence.runId !== action.runId ||
    evidence.assignmentRevision !== node.assignmentRevision ||
    evidence.agentId !== node.assigneeAgentId ||
    evidence.leaseId !== node.leaseId
  ) {
    throw new Error("The completion reconciliation evidence differs from the current graph.");
  }
  const coordinate = {
    projectId: input.report.projectId,
    workstreamId: input.report.workstreamId,
    expectedGraphHash: input.report.graph.graphHash,
    completionEvidenceId: evidence.completionEvidenceId,
    assignmentId: evidence.assignmentId,
    assignmentRevision: evidence.assignmentRevision,
    runId: evidence.runId,
    sessionId: evidence.sessionId,
    agentId: evidence.agentId,
    leaseId: evidence.leaseId,
    resultArtifactId: evidence.resultArtifactId,
    resultContentHash: evidence.resultContentHash,
    preparedAt: evidence.preparedAt,
  };
  return {
    schemaVersion: 1,
    kind: "governed_completion.reconcile",
    commandId: `gcr_${sha256(JSON.stringify(coordinate)).slice("sha256:".length, "sha256:".length + 24)}`,
    ...coordinate,
  };
}
