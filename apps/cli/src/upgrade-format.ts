import { repositoryReleaseCommand } from "@lervo/repository-registry";
import { repositoryReplicaPerCallLauncherGuidance } from "@lervo/sync";

import { documentRouteDeferralLines } from "./document-route-deferral-attention.js";
import { layoutCapacityLines } from "./layout-capacity-lines.js";
import type { EventWriterBackupRetentionOutcome } from "./event-writer-backup-retention.js";
import { eventWriterBackupRetentionLines } from "./event-writer-backup-retention-format.js";
import type { NodeConfigExecutablesStage } from "./node-config-executable-upgrade.js";
import type { RepositoryUpgradePlan } from "./upgrade-plan.js";
import type { UpgradeStageTiming } from "./upgrade-stage-timing.js";
import type { UpgradeStageBlocker } from "./upgrade-stage-inspection.js";
import type { StageDisposition, UpgradeStageName } from "./upgrade-stage-policy.js";

export interface UpgradeReceipt {
  schemaVersion: 1;
  operation: "repository_upgrade";
  /** The plan recreated and applied inside the exclusive window. */
  planId: string;
  status: RepositoryUpgradePlan["status"];
  appliedStages: string[];
  skippedStages: Array<{ stage: string; reason: string }>;
  /** ADR-0561 after-the-fact notices: what changed and the one way to undo it. */
  notices: Array<{ stage: UpgradeStageName; summary: string; undo: string }>;
  knowledgeLint: { valid: boolean; issueCount: number } | null;
  /** ADR-0651: superseded event writer backups this apply removed. Absent when none. */
  eventWriterBackupRetention?: EventWriterBackupRetentionOutcome;
  nextPlanId: string | null;
  pending: Array<{
    stage: UpgradeStageName;
    disposition: StageDisposition;
    reason: string;
    blockers: UpgradeStageBlocker[];
  }>;
  cliAcquisition: "outside_repository_upgrade";
  /**
   * ADR-0575 measurement: milliseconds spent waiting for the host's knowledge admission, and
   * applying after it was granted. Absent from receipts of earlier CLIs.
   */
  timing?: { admissionWaitMs: number; applyMs: number };
  /** ADR-0579: the apply's consecutive parts after admission. Absent from earlier CLIs. */
  stageTimings?: UpgradeStageTiming[];
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
    ...(plan.hold === null
      ? []
      : [
          `repository hold: held by the owner since ${plan.hold.heldAt}${plan.hold.reason === null ? "" : ` (${plan.hold.reason})`}; no stage that changes this repository applies until ${repositoryReleaseCommand(plan.repositoryRoot)}`,
        ]),
    `runtime retention: ${plan.stages.runtimeRetention.disposition} (${plan.stages.runtimeRetention.reason}) · ${plan.stages.runtimeRetention.candidates.length} directories, ${plan.stages.runtimeRetention.reclaimableBytes} bytes`,
    ...plan.stages.runtimeRetention.candidates.map(
      (item) => `  remove runtime ${item.name} (${item.bytes} bytes)`,
    ),
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
    ...layoutCapacityLines(
      plan.stages.knowledge.layoutCapacity ?? [],
      "  ",
      plan.stages.knowledge.layoutCapacityCount,
    ),
    `repository Node: ${plan.stages.node.disposition} (${plan.stages.node.reason})`,
    ...nodeConfigExecutableLines(plan.stages.node.configExecutables),
    `event writer: ${plan.stages.eventWriter.disposition} (${plan.stages.eventWriter.reason}) · schema ${plan.stages.eventWriter.currentSchemaVersion} → ${plan.stages.eventWriter.targetSchemaVersion}`,
    ...blockerLines(plan.stages.eventWriter.blockers, "  "),
    ...eventWriterBackupRetentionLines(plan.stages.eventWriterBackupRetention),
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
    ...(plan.stages.replicaService.peerLauncher === null
      ? []
      : [`  ${repositoryReplicaPerCallLauncherGuidance(plan.stages.replicaService.peerLauncher)}`]),
    ...blockerLines(plan.stages.replicaService.blockers, "  "),
    ...(plan.stages.hostService.unmanagedResidentRunning
      ? [
          "  A host resident started outside the managed service is running; the managed one stays on standby until it stops. Remove the hand-written service.",
        ]
      : []),
  ];
  for (const refresh of plan.stages.workforce.repositoryRoleRefreshes)
    lines.push(
      `  repository role refresh: ${refresh.roleId}@${refresh.roleVersion} · ${refresh.staleAgentCount} agent(s), ${refresh.staleAssignmentCount} assignment(s)`,
    );
  if (plan.status === "ready")
    lines.push(
      "Re-run with --apply. It plans again and applies in one exclusive window: reviewed plans are cross-checked, provider hook files and service definitions are backed up and verified, and the receipt prints each undo.",
    );
  if (plan.status === "blocked" && plan.applicableStages.length > 0)
    lines.push(
      `Independent stages can still apply (${plan.applicableStages.join(", ")}): re-run with --apply. The blocked stage stays blocked until its blockers are resolved.`,
    );
  if (plan.status === "lervo_debt")
    lines.push(
      "Lervo debt (no owner action): Lervo holds the stages above itself and retries them; inspect lervo application attention --json.",
    );
  lines.push("CLI package acquisition is outside this repository-upgrade plan.");
  return `${lines.join("\n")}\n`;
}

export function formatUpgradeReceipt(receipt: UpgradeReceipt): string {
  const lines = [
    `Repository upgrade: ${receipt.status}`,
    `applied: ${receipt.appliedStages.length === 0 ? "none" : receipt.appliedStages.join(", ")}`,
    ...receipt.skippedStages.map((item) => `skipped: ${item.stage} (${item.reason})`),
    ...receipt.notices.map((item) => `notice: ${item.stage}: ${item.summary} Undo: ${item.undo}`),
    ...(receipt.eventWriterBackupRetention === undefined
      ? []
      : [
          `event writer backups removed: ${receipt.eventWriterBackupRetention.removed.join(", ")} · ${receipt.eventWriterBackupRetention.reclaimedBytes} bytes reclaimed`,
        ]),
    ...(receipt.nextPlanId === null ? [] : [`next plan: ${receipt.nextPlanId}`]),
    ...(receipt.knowledgeLint === null || receipt.knowledgeLint.valid
      ? []
      : [
          `knowledge lint: ${receipt.knowledgeLint.issueCount} issue(s) in repository content; the knowledge resident repairs them, and other stages were applied (lervo knowledge lint --json)`,
        ]),
  ];
  for (const item of receipt.pending)
    lines.push(
      `pending: ${item.stage} ${item.disposition} (${item.reason})`,
      ...blockerLines(item.blockers, "  "),
    );
  return `${lines.join("\n")}\n`;
}
