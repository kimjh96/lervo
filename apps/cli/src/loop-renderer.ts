import type { GovernedWorkReportV1 } from "@lervo/application-contract";

import type { GovernedAttemptRunResult } from "./governed-attempt-runner.js";
import type { GovernedCompletionReconciliationResult } from "./governed-completion-reconciliation-command.js";

function formatAction(action: GovernedWorkReportV1["decision"]["actions"][number]): string {
  return `${action.kind}${action.assignmentId === null ? "" : ` ${action.assignmentId}`} (${action.reasonCode})`;
}

export function formatGovernedWorkReport(report: GovernedWorkReportV1): string {
  const lines = [
    `Governed work: ${report.decision.status}`,
    `workstream: ${report.workstreamId}`,
    `graph: ${report.graph.graphId} · ${report.graph.nodes.length} nodes · ${report.graph.joinAssignmentIds.length} joins`,
    `attempts: ${report.attempts.length}`,
    `prepared completions: ${report.completionEvidence.length}`,
    `resources: ${
      report.resources.length === 0
        ? "unobserved"
        : report.resources
            .map(
              (resource) =>
                `${resource.provider}/${resource.scope}/${resource.accountingDescriptorHash.slice(0, 15)}=${resource.totalTokens ?? "unavailable"} total, ${resource.tokenUsage?.inputTokens ?? "unknown"} input, ${resource.tokenUsage?.cachedInputTokens ?? "unknown"} cached input, ${resource.tokenUsage?.outputTokens ?? "unknown"} output (${resource.completeness})`,
            )
            .join(", ")
    }`,
    "next actions:",
    ...report.decision.actions.map((action) => `  ${formatAction(action)}`),
  ];
  return `${lines.join("\n")}\n`;
}

export function renderCompletionReconciliationResult(
  result: GovernedCompletionReconciliationResult,
  json: boolean,
): string {
  if (json) return `${JSON.stringify(result, null, 2)}\n`;
  return result.status === "planned"
    ? `Completion reconciliation plan ${result.commandId} is ready for ${result.assignmentId}; no state changed.\n`
    : `Completion reconciliation ${result.commandId} completed ${result.assignmentId}.\n`;
}

export function renderGovernedAttemptResult(
  result: GovernedAttemptRunResult,
  json: boolean,
): { channel: "stdout" | "stderr"; output: string; exitCode: number } {
  if (result.status === "completed") {
    return {
      channel: "stdout",
      output: json
        ? `${JSON.stringify({ outcome: result.outcome, assignmentFinalization: "completed" }, null, 2)}\n`
        : `Governed attempt completed assignment ${result.assignmentId}.\n`,
      exitCode: 0,
    };
  }
  if (result.status === "execution_failed") {
    return {
      channel: "stderr",
      output: json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Governed attempt failed (${result.code}); effect=${result.effectState}; retry=${result.retryAvailable}.\n`,
      exitCode: 1,
    };
  }
  if (result.status === "budget_rejected") {
    return {
      channel: "stderr",
      output: json
        ? `${JSON.stringify(result, null, 2)}\n`
        : `Governed attempt was rejected after observed budget assessment (${result.reasonCode}).\n`,
      exitCode: 1,
    };
  }
  return {
    channel: "stdout",
    output: json
      ? `${JSON.stringify(result, null, 2)}\n`
      : `Governed attempt was not accepted; retry=${result.retryAvailable}.\n`,
    exitCode: 1,
  };
}
