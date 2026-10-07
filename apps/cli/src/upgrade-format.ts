import { documentRouteDeferralLines } from "./document-route-deferral-attention.js";
import type { NodeConfigExecutablesStage } from "./node-config-executable-upgrade.js";
import type { RepositoryUpgradePlan } from "./upgrade-plan.js";
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

/** ADR-0488: what the Node stage changes in the host CLI pointer and the Node configuration. */
function nodeConfigExecutableLines(stage: NodeConfigExecutablesStage | undefined): string[] {
  if (stage === undefined) return [];
  const lines: string[] = [];
  if (stage.cliPointer === "create" || stage.cliPointer === "update")
    lines.push(
      `  The host CLI pointer moves to the CLI running this upgrade (${stage.cliPointer}).`,
    );
  if (stage.config === "migrate")
    lines.push(
      `  The Node configuration names the host CLI pointer instead of a version-specific path in ${stage.rewrittenFields.length} field(s); a .pre-adr-0488 backup stays beside it.`,
    );
  if (stage.overrideFields.length > 0)
    lines.push(
      `  These CLI fields keep an explicit path that will not follow later installs: ${stage.overrideFields.join(", ")}.`,
    );
  if (stage.retainedFields.length > 0)
    lines.push(
      `  These fields keep a Node runtime path until the current runtime pointer exists: ${stage.retainedFields.join(", ")}.`,
    );
  return lines;
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
    ...documentRouteDeferralLines(plan.stages.knowledge.deferredDocuments ?? [], "  "),
    `repository Node: ${plan.stages.node.disposition} (${plan.stages.node.reason})`,
    ...nodeConfigExecutableLines(plan.stages.node.configExecutables),
    `event writer: ${plan.stages.eventWriter.disposition} (${plan.stages.eventWriter.reason}) · schema ${plan.stages.eventWriter.currentSchemaVersion} → ${plan.stages.eventWriter.targetSchemaVersion}`,
    ...blockerLines(plan.stages.eventWriter.blockers, "  "),
    `host resident service: ${plan.stages.hostService.disposition} (${plan.stages.hostService.reason})${
      plan.stages.hostService.serviceIdentity === null
        ? ""
        : ` · ${plan.stages.hostService.serviceIdentity} · ${plan.stages.hostService.action}`
    } · ${plan.stages.hostService.servedRepositoryCount} served, ${plan.stages.hostService.nodeServedRepositoryCount} Node-served`,
    ...blockerLines(plan.stages.hostService.blockers, "  "),
    `repository replica service: ${plan.stages.replicaService.disposition} (${plan.stages.replicaService.reason})${
      plan.stages.replicaService.runtime === null
        ? ""
        : ` · current runtime ${plan.stages.replicaService.runtime} (${plan.stages.replicaService.pointerAction})`
    }${
      plan.stages.replicaService.serviceIdentity === null
        ? ""
        : ` · ${plan.stages.replicaService.serviceIdentity} · ${plan.stages.replicaService.action}`
    }`,
    ...(plan.stages.replicaService.configMigration === "migrate"
      ? [
          "  The coordinator configuration moves from ~/.lervo into the Lervo user state directory; a .pre-adr-0483 backup stays beside the old file.",
        ]
      : []),
    ...(plan.stages.replicaService.peerRuntimeOverride
      ? [
          "  The peer runtime stays an explicit path outside any runtimes directory, so it will not follow later deploys. Set peer.remoteRuntimesDirectory to follow them.",
        ]
      : []),
    ...blockerLines(plan.stages.replicaService.blockers, "  "),
    ...(plan.stages.hostService.unmanagedResidentRunning
      ? [
          "  A host resident started outside the managed service is running; the managed one stays on standby until it stops. Remove the hand-written service.",
        ]
      : []),
  ];
  for (const approval of plan.stages.workforce.requiredApprovals)
    lines.push(
      `  role approval: ${approval.roleId}@${approval.roleVersion} · ${approval.operationId}=${approval.approvalHash}`,
    );
  if (plan.status === "ready" && plan.stages.workforce.requiredApprovals.length === 0)
    lines.push(
      `Re-run with --apply --approval ${plan.planId}, or with --apply --safe to plan and apply in one exclusive step while background work keeps changing the repository.`,
    );
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
