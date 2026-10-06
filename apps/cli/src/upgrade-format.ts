import type { RepositoryUpgradePlan } from "./upgrade-command.js";
import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";
import type { StageDisposition, UpgradeStageName } from "./upgrade-stage-policy.js";

export interface UpgradeReceipt {
  schemaVersion: 1;
  operation: "repository_upgrade";
  approvedPlanId: string;
  status: RepositoryUpgradePlan["status"];
  appliedStages: string[];
  skippedStages: Array<{ stage: string; reason: string }>;
  knowledgeLint: { valid: boolean; issueCount: number } | null;
  nextPlanId: string | null;
  pending: Array<{
    stage: UpgradeStageName;
    disposition: StageDisposition;
    reason: string;
    blockers: UpgradeStageBlocker[];
  }>;
  cliAcquisition: "outside_repository_upgrade";
}

function blockerLines(blockers: readonly UpgradeStageBlocker[], indent: string): string[] {
  return blockers.flatMap((blocker) => {
    const lines = [
      `${indent}blocker [${blocker.code}]${blocker.path === undefined ? "" : ` ${blocker.path}`}`,
    ];
    if (blocker.message !== undefined)
      lines.push(...blocker.message.split("\n").map((line) => `${indent}  ${line.trim()}`));
    return lines;
  });
}

export function formatUpgradePlan(plan: RepositoryUpgradePlan): string {
  const lines = [
    `Repository upgrade: ${plan.status}`,
    `plan: ${plan.planId}`,
    `CLI: ${plan.cli.version} · ${plan.cli.buildHash}`,
    `capabilities: ${plan.stages.capabilities.disposition}`,
    `workforce role bindings: ${plan.stages.workforce.disposition} (${plan.stages.workforce.reason})`,
    `terminal integration: ${plan.stages.terminalIntegration.disposition} (${plan.stages.terminalIntegration.reason})`,
    ...blockerLines(plan.stages.terminalIntegration.blockers, "  "),
    `knowledge: ${plan.stages.knowledge.disposition} (${plan.stages.knowledge.reason})${
      plan.stages.knowledge.backgroundDebt === undefined
        ? ""
        : ` · ${plan.stages.knowledge.backgroundDebt.pendingDocuments} pending document(s) owned by the background resident through its ${plan.stages.knowledge.backgroundDebt.owner === "delegation" ? "delegation" : "host continuity policy"}`
    }`,
    ...blockerLines(plan.stages.knowledge.blockers, "  "),
    `repository Node: ${plan.stages.node.disposition} (${plan.stages.node.reason})`,
  ];
  for (const approval of plan.stages.workforce.requiredApprovals)
    lines.push(
      `  role approval: ${approval.roleId}@${approval.roleVersion} · ${approval.operationId}=${approval.approvalHash}`,
    );
  if (plan.status === "ready" && plan.stages.workforce.requiredApprovals.length === 0)
    lines.push(`Re-run with --apply --approval ${plan.planId}.`);
  if (
    plan.status === "blocked" &&
    plan.applicableStages.length > 0 &&
    plan.stages.workforce.requiredApprovals.length === 0
  )
    lines.push(
      `Independent stages can still apply (${plan.applicableStages.join(", ")}): re-run with --apply --approval ${plan.planId}. The blocked stage stays blocked until its blockers are resolved.`,
    );
  if (plan.stages.workforce.requiredApprovals.length > 0)
    lines.push(
      `Apply the displayed role decision with --apply --approval ${plan.planId} ${plan.stages.workforce.requiredApprovals
        .map(
          (approval) => `--approve-role-binding ${approval.operationId}=${approval.approvalHash}`,
        )
        .join(" ")}.`,
    );
  if (plan.status === "pending_authority")
    lines.push(
      "A user-owned or provider-owned boundary requires its separately displayed exact approval before the upgrade can become current.",
    );
  lines.push("CLI package acquisition is outside this repository-upgrade plan.");
  return `${lines.join("\n")}\n`;
}

export function formatUpgradeReceipt(receipt: UpgradeReceipt): string {
  const lines = [
    `Repository upgrade: ${receipt.status}`,
    `applied: ${receipt.appliedStages.length === 0 ? "none" : receipt.appliedStages.join(", ")}`,
    ...receipt.skippedStages.map((item) => `skipped: ${item.stage} (${item.reason})`),
    ...(receipt.nextPlanId === null ? [] : [`next plan: ${receipt.nextPlanId}`]),
  ];
  for (const item of receipt.pending)
    lines.push(
      `pending: ${item.stage} ${item.disposition} (${item.reason})`,
      ...blockerLines(item.blockers, "  "),
    );
  return `${lines.join("\n")}\n`;
}
