import { applyNodeRuntimeRetention } from "./node-runtime-retention.js";
import { rememberTerminalWorkerEntry } from "./terminal-worker-entry.js";
import { applyCapabilityMigration, createCapabilityMigrationPlan } from "@lervo/capabilities";
import { applyWorkforceRoleBindingMigration } from "@lervo/agent-workforce";

import type { KnowledgeMaterializationSettlement } from "@lervo/repository-knowledge";

import { CommandFailure } from "./command-error-output.js";
import { applyEventWriterStage } from "./event-writer-activation-stage.js";
import { effectBackupUndoCommand } from "./effect-backup.js";
import { holdEffect, releaseHeldEffects } from "./held-effect-debt.js";
import { applyKnowledgeStages } from "./upgrade-knowledge-apply.js";
import { knowledgeStageSkipReason } from "./upgrade-knowledge-gate.js";
import { noticeEffect } from "./effect-notice.js";
import { applyHostResidentService } from "./knowledge-host-service.js";
import {
  applyRepositoryReplicaService,
  inspectRepositoryReplicaService,
} from "./repository-replica-service.js";
import { applyTerminalIntegrationStage } from "./terminal-integration-stage.js";
import type { UpgradeReceipt } from "./upgrade-format.js";
import type { UpgradeHost } from "./upgrade-host.js";
import { applyRegisteredNodeUpgrade, inspectRegisteredNodeUpgrade } from "./upgrade-node.js";
import {
  createRepositoryUpgradePlan,
  knowledgeStageRefusedByMarker,
  type RepositoryUpgradePlan,
} from "./upgrade-plan.js";
import type { UpgradeResidentExclusion } from "./upgrade-resident-exclusion.js";
import { terminalIntegrationHoldSubject } from "./upgrade-terminal-inspection.js";
import {
  inspectTerminalIntegration,
  inspectWorkforce,
  lintKnowledge,
  type UpgradeStageBlocker,
} from "./upgrade-stage-inspection.js";
import {
  knowledgeLintSkipReason,
  type StageDisposition,
  type UpgradeStageName,
} from "./upgrade-stage-policy.js";
import type { UpgradeStageClock } from "./upgrade-stage-timing.js";
import type { CliServices } from "./types.js";
import { mutateWorkforceState } from "./workforce-mutation.js";
import { recordPendingAgentOrigins } from "./agent-origin-stage.js";

export function pendingStages(plan: RepositoryUpgradePlan): UpgradeReceipt["pending"] {
  const stages: Array<{
    stage: UpgradeStageName;
    disposition: StageDisposition;
    reason: string;
    blockers?: UpgradeStageBlocker[];
  }> = [
    {
      stage: "capabilities",
      disposition: plan.stages.capabilities.disposition,
      reason: "capability_migration_pending",
    },
    { stage: "workforce", ...plan.stages.workforce },
    { stage: "terminal_integration", ...plan.stages.terminalIntegration },
    { stage: "knowledge", ...plan.stages.knowledge },
    { stage: "node", ...plan.stages.node },
    { stage: "event_writer", ...plan.stages.eventWriter },
    { stage: "host_service", ...plan.stages.hostService },
    { stage: "replica_service", ...plan.stages.replicaService },
  ];
  return stages
    .filter((stage) => stage.disposition === "lervo_debt" || stage.disposition === "blocked")
    .map((stage) => ({
      stage: stage.stage,
      disposition: stage.disposition,
      reason: stage.reason,
      blockers: stage.blockers ?? [],
    }));
}

/**
 * Applies the plan recreated inside the exclusive window, stage by stage in the published order
 * (ADR-0561). Each stage plans again and compares before it writes, so a stale stage refuses
 * instead of applying. Reviewed knowledge plans are cross-checked first, provider hook files and
 * service definitions are backed up and verified, and every undo is reported. Every knowledge step
 * runs through the command's materialization settlement, so background knowledge work that starts
 * between stages delays the upgrade instead of failing it. ADR-0577: every stage that changes the
 * repository or a service first confirms the resident exclusion.
 */
export async function applyRepositoryUpgrade(
  approved: RepositoryUpgradePlan,
  materialization: KnowledgeMaterializationSettlement,
  host: UpgradeHost,
  exclusion: UpgradeResidentExclusion,
  clock: UpgradeStageClock,
  services: Partial<Pick<CliServices, "crossCheckPlan">> = {},
): Promise<UpgradeReceipt> {
  const root = approved.repositoryRoot;
  const appliedStages: string[] = [];
  const skippedStages: UpgradeReceipt["skippedStages"] = [];
  const notices: UpgradeReceipt["notices"] = [];
  const confirmExclusion = (nextStage: UpgradeStageName | "terminal_worker_entry" | null) =>
    exclusion.assertHeld({ nextStage, appliedStages });
  await confirmExclusion("terminal_worker_entry");
  await rememberTerminalWorkerEntry(root, process.env.LERVO_CLI_ENTRY);

  if (approved.stages.capabilities.disposition === "safe_apply") {
    const capabilityPlan = await createCapabilityMigrationPlan(root);
    if (capabilityPlan.planId !== approved.stages.capabilities.planId)
      throw new Error("The capability migration plan changed before apply.");
    await confirmExclusion("capabilities");
    await applyCapabilityMigration(capabilityPlan);
    appliedStages.push("capabilities");
  }
  clock.lap("capabilities");

  // ADR-0561: a held repository applies no stage that changes it; its plan shows them as debt.
  const held = approved.hold !== null;
  const workforce = held ? null : await inspectWorkforce(root);
  if (workforce?.disposition === "blocked")
    skippedStages.push({ stage: "workforce", reason: workforce.reason });
  else if (workforce?.disposition === "safe_apply") {
    await confirmExclusion("workforce");
    const migrated = await mutateWorkforceState(root, (recordEvent) =>
      applyWorkforceRoleBindingMigration({
        repositoryRoot: root,
        planId: workforce.planId!,
        recordEvent,
      }),
    );
    if (migrated.migratedAgentCount + migrated.migratedAssignmentCount > 0) {
      appliedStages.push("workforce_role_bindings");
      if (workforce.repositoryRoleRefreshes.length > 0)
        notices.push({
          stage: "workforce",
          summary: `Refreshed bindings to the current repository roles ${workforce.repositoryRoleRefreshes
            .map((item) => `${item.roleId}@${item.roleVersion}`)
            .join(", ")}; each binding-change event records the previous binding.`,
          undo: "Revert the role source in .lervo/roles with Git, then run lervo upgrade --apply.",
        });
    }
  }
  // ADR-0643: each agent records whether it is the team's or Lervo's own, once.
  if (!held && workforce?.disposition !== "blocked") {
    await confirmExclusion("workforce");
    if ((await recordPendingAgentOrigins(root)) > 0) appliedStages.push("workforce_origins");
  }
  clock.lap("workforce");

  const terminalNow =
    approved.stages.terminalIntegration.disposition === "safe_apply"
      ? await inspectTerminalIntegration(root)
      : null;
  if (
    terminalNow !== null &&
    terminalNow.stage.planId !== approved.stages.terminalIntegration.planId
  )
    throw new Error("The terminal integration plan changed before apply.");
  // ADR-0610: a checkout that left the base branch since planning holds the stage instead.
  if (terminalNow !== null && terminalNow.stage.disposition !== "safe_apply")
    skippedStages.push({ stage: "terminal_integration", reason: terminalNow.stage.reason });
  else if (terminalNow !== null) {
    const terminal = terminalNow;
    await confirmExclusion("terminal_integration");
    try {
      const { backupId, commit } = await applyTerminalIntegrationStage({
        repositoryRoot: root,
        prepared: terminal.prepared,
        now: new Date(),
      });
      appliedStages.push("terminal_integration");
      if (commit.status === "not_committed" && commit.reason !== "nothing_to_commit")
        notices.push({
          stage: "terminal_integration",
          summary: `The refreshed launcher and hook files verified current but were not committed (${commit.reason}); the next upgrade on the base branch commits them.`,
          undo: "git restore -- .lervo/generated/terminal-hooks",
        });
      await releaseHeldEffects(root, "upgrade_terminal_integration");
      if (backupId !== null)
        notices.push({
          stage: "terminal_integration",
          summary:
            "Merged the Lervo hooks into the provider hook files after backing them up; the result verified current.",
          undo: effectBackupUndoCommand(backupId),
        });
    } catch (error) {
      if (!(
        error instanceof CommandFailure && error.code === "terminal_integration_verification_failed"
      ))
        throw error;
      // The backup is already restored; the independent stages still apply.
      await holdEffect({
        repositoryRoot: root,
        effect: "upgrade_terminal_integration",
        subject: terminalIntegrationHoldSubject(terminal.prepared.plan),
        reasonCode: "verification_failed",
      });
      skippedStages.push({ stage: "terminal_integration", reason: "verification_failed_restored" });
    }
  }
  clock.lap("terminal_integration");

  // ADR-0610: where the knowledge stage waits, the plan already shows it as debt for this reason.
  const knowledgeWait = held
    ? null
    : await knowledgeStageSkipReason(root, approved.stages.knowledge);
  // A record held because no commit was possible is the same wait the plan now carries; leaving it
  // would keep the plan held after the wait ends, while the stage skipped here never settles it.
  if (knowledgeWait !== null)
    await releaseHeldEffects(
      root,
      "upgrade_knowledge",
      (item) => item.reasonCode !== "commit_unavailable",
    );
  const knowledgeOutcome = held
    ? { appliedStages: [], skippedStages: [], notices: [], lastStage: null }
    : knowledgeWait !== null
      ? {
          appliedStages: [],
          skippedStages: [{ stage: "knowledge", reason: knowledgeWait }],
          notices: [],
          lastStage: approved.stages.knowledge,
        }
      : await applyKnowledgeStages({
          repositoryRoot: root,
          maximumStages: approved.policy.maximumKnowledgeStages,
          materialization,
          services,
          confirmExclusion: () => confirmExclusion("knowledge"),
          lap: () => clock.lap("knowledge"),
        });
  const knowledge = knowledgeOutcome.lastStage;
  appliedStages.push(...knowledgeOutcome.appliedStages);
  skippedStages.push(...knowledgeOutcome.skippedStages);
  notices.push(...knowledgeOutcome.notices);

  // ADR-0546: the Node stage is ordered after knowledge without depending on it, and lint reports
  // a blocked knowledge stage instead of being skipped.
  const node = held
    ? null
    : await inspectRegisteredNodeUpgrade(
        root,
        approved.projectId,
        approved.cli.version,
        host.describeNodeLauncher,
      );
  clock.lap("node_inspection");
  if (node !== null && node.stage.disposition === "safe_apply") {
    // The service definition is backed up, applied as a transaction, verified ready, and rolled
    // back on failure inside the guarded Node transition (ADR-0561).
    await confirmExclusion("node");
    const onboarding = await applyRegisteredNodeUpgrade(node, host.describeNodeLauncher);
    clock.lapNode(onboarding?.timing);
    appliedStages.push("repository_node");
    notices.push({
      stage: "node",
      summary: `Moved the repository Node to ${approved.cli.version} after it verified ready; a failed readiness check would have restored the previous service definition.`,
      undo: "Activate the previous Lervo CLI, whose runtime stays pinned, and run lervo upgrade --apply.",
    });
  }
  const lintSkip = knowledgeLintSkipReason(appliedStages, knowledge);
  if (lintSkip !== null) skippedStages.push({ stage: "knowledge_lint", reason: lintSkip });
  const lint: UpgradeReceipt["knowledgeLint"] =
    lintSkip === null ? await materialization.run(() => lintKnowledge(root)) : null;
  clock.lap("knowledge_lint");

  // The event writer stage re-observes the hook reader and the Node and Hub readers itself, so a
  // stage deferred behind them applies once they are current and is skipped otherwise.
  const eventWriter = approved.stages.eventWriter;
  if (eventWriter.disposition === "safe_apply" || eventWriter.disposition === "deferred") {
    await confirmExclusion("event_writer");
    const outcome = await applyEventWriterStage(root, eventWriter, host.eventWriter);
    if (outcome.status === "activated") appliedStages.push("event_writer");
    else if (outcome.status === "skipped")
      skippedStages.push({
        stage: "event_writer",
        reason: outcome.stage.blockers[0]?.code ?? outcome.stage.reason,
      });
  }
  clock.lap("event_writer");

  if (approved.stages.hostService.disposition === "safe_apply") {
    await confirmExclusion("host_service");
    const service = await applyHostResidentService(approved.stages.hostService, host.hostService);
    if (service !== null) appliedStages.push("host_service");
  }
  clock.lap("host_service");

  // ADR-0483: a stage deferred behind the Node stage is re-observed, because an activated Node
  // already moved `current`; an approved stage is applied against its exact plan.
  const replicaStage =
    approved.stages.replicaService.disposition === "deferred"
      ? await inspectRepositoryReplicaService(host.replicaService)
      : approved.stages.replicaService;
  if (replicaStage.disposition === "safe_apply") {
    await confirmExclusion("replica_service");
    if ((await applyRepositoryReplicaService(replicaStage, host.replicaService)) !== null)
      appliedStages.push("replica_service");
  }
  clock.lap("replica_service");

  await confirmExclusion("runtime_retention");
  if (await applyNodeRuntimeRetention(approved.stages.runtimeRetention, host.runtimeRetention))
    appliedStages.push("runtime_retention");
  // A holder that still holds was never replaced, so every stage ran under the exclusion.
  await confirmExclusion(null);
  clock.lap("runtime_retention");

  // ADR-0561: the workforce and Node stages have no commit or backup of their own, so their
  // notices join the effect notice journal; the other stages record theirs where they apply.
  for (const [index, notice] of notices.entries())
    if (notice.stage === "workforce" || notice.stage === "node")
      await noticeEffect({
        repositoryRoot: root,
        effect: notice.stage === "node" ? "node_service_upgrade" : "workforce_role_refresh",
        subject: `${approved.planId}:${index}`,
        targets: [approved.planId],
        reason: notice.summary,
        reviewers: [notice.stage === "node" ? "Node readiness check" : "role contract validation"],
        verdict: "verified",
        undo: notice.undo,
      });

  const final = await materialization.run(
    () => createRepositoryUpgradePlan(root, host),
    knowledgeStageRefusedByMarker,
  );
  clock.lap("final_plan");
  return {
    schemaVersion: 1,
    operation: "repository_upgrade",
    planId: approved.planId,
    status: final.status,
    appliedStages,
    skippedStages,
    notices,
    knowledgeLint: lint,
    nextPlanId: final.status === "current" ? null : final.planId,
    pending: pendingStages(final),
    cliAcquisition: "outside_repository_upgrade",
    stageTimings: clock.timings,
  };
}
